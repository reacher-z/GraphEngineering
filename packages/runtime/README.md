# `@graph-engineering/runtime`

A small, deterministic TypeScript scheduler for the Graph Engineering v1alpha1
IR, with in-memory execution, event-sourced durable continuation, and a separate
standalone bounded-pipeline API.

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

## Standalone bounded pipeline

`runPipeline` moves independent portable-JSON items through the same ordered
stages. Different items can occupy different stages at once; bounded queues and
a global in-flight window carry consumer backpressure all the way to source
pulls.

```ts
import {
  runPipeline,
  type PipelineStage,
} from "@graph-engineering/runtime";

const stages: PipelineStage[] = [
  {
    id: "double",
    concurrency: 2,
    handler: ({ input }) => {
      if (typeof input !== "number") throw new TypeError("expected a number");
      return input * 2;
    },
  },
  {
    id: "label",
    handler: ({ input, itemIndex }) => ({ itemIndex, value: input }),
  },
];

const run = runPipeline([1, 2, 3], stages, {
  bufferCapacity: 2,
  maxInFlight: 2,
  // Set this above a known finite source length. Reaching the exact limit is a
  // bounded run failure because the pipeline deliberately does not peek again.
  maxItems: 4,
  ordering: "input",
});

for await (const item of run) {
  console.log(item.itemIndex, item.status, item.output);
}

const summary = await run.completion;
console.log(summary.status, summary.accepted, summary.emitted);
```

The factory is synchronous and lazy: it validates and copies the stage/options
configuration immediately, but does not create or advance the source iterator
until the first `next()` from a consumer. One run is a single-pass,
single-consumer `AsyncIterableIterator`; `[Symbol.asyncIterator]()` returns the
same object, and overlapping `next()` calls reject instead of racing delivery.
The source may be synchronous or asynchronous; the stage iterable must be
finite. An empty stage list is a valid identity pipeline, and an empty source
completes without item results.

The public surface is:

```ts
runPipeline(
  source: Iterable<unknown> | AsyncIterable<unknown>,
  stages: Iterable<PipelineStage>,
  options?: PipelineOptions,
): PipelineRun;

interface PipelineRun extends AsyncIterableIterator<PipelineItemResult> {
  readonly completion: Promise<PipelineSummary>;
  close(reason?: unknown): Promise<PipelineSummary>;
}
```

Breaking a `for await` loop invokes the iterator's `return()`, which delegates
to idempotent `close()`. If you drive `next()` manually, call `close()` in a
`finally` block when stopping early. `close()` and `completion` resolve to the
same terminal summary. On natural exhaustion, consume the iterator before
awaiting `completion`: results remain bounded by retaining in-flight credit
until the consumer receives them, so completion may legitimately wait for an
open consumer to drain or close.

### Stages and options

Each `PipelineStage` has a non-empty unique `id`, a synchronous or asynchronous
`handler`, and these optional controls:

| Field | Default | Contract |
|---|---:|---|
| `concurrency` | `1` | Safe positive integer; counts active handler attempts |
| `timeoutMs` | none | Integer from `0` through `2^31 - 1`; starts immediately before the handler call |
| `retry.maxAttempts` | `1` | Safe positive integer including the first attempt |
| `retry.initialDelayMs` | `0` | Finite non-negative retry delay, at most `2^31 - 1` |
| `retry.backoffMultiplier` | `1` | Finite number at least `1` |
| `retry.maxDelayMs` | `initialDelayMs` | Finite non-negative computed-delay cap, at most `2^31 - 1` |
| `onFailure` | `"dead-letter"` | `"stop"`, `"drop"`, or `"dead-letter"` |

After failed attempt `k`, the delay before attempt `k + 1` is
`min(maxDelayMs, initialDelayMs * backoffMultiplier ** (k - 1))`.

The handler receives a frozen context containing a detached `input`, zero-based
`itemIndex`, `stageId`, zero-based `stageIndex`, one-based `attempt`, and a
cooperative `AbortSignal`. A validated handler output is detached before it can
enter the next stage. The pipeline does not infer map, filter, flatten, or merge
operations; express each one as an explicit stage.

`PipelineOptions` defaults are:

| Field | Default | Contract |
|---|---:|---|
| `bufferCapacity` | `16` | Safe positive integer per source/stage boundary |
| `maxInFlight` | `16` | Safe positive integer global admission window |
| `maxItems` | `1000` | Safe positive integer hard admission budget |
| `maxStages` | `2048` | Lowerable stage-copy budget; hard maximum `2048` |
| `ordering` | `"input"` | Terminal delivery is `"input"` or `"completion"` order |
| `cancellationSignal` | none | Caller-owned `AbortSignal` |

The producer acquires in-flight credit before it pulls the source. Credit is
released only when the terminal item result is delivered to the consumer, so
`accepted - emitted <= maxInFlight` even with a slow consumer. Each boundary
queue stays at or below `bufferCapacity`. Input ordering can delay a fast later
result behind a slow earlier result, but the reorder buffer remains bounded;
ordering never serializes internal stages or their side effects.

`maxItems` includes invalid inputs. At the exact limit the source is not probed
again, accepted work drains, and the summary contains
`runFailure.code: "ITEM_LIMIT_REACHED"`. The constructor also rejects an unsafe
derived bound for `maxItems * sum(stage maxAttempts)` before source iteration.
It also rejects a stage iterable with more than `maxStages` entries before the
item source is constructed, so an accidental infinite stage generator cannot
consume an unbounded number of configuration pulls.

### Results and failure policies

Every accepted item is accounted as `succeeded`, `failed`, `dropped`, or
`cancelled`. Valid JSON `null` remains a real input/output; `inputBound`
distinguishes it from an invalid source value that could not be snapshotted.
Portable JSON is detached, acyclic, finite, and uses interoperable safe
integer bounds; finite non-integer numbers remain valid. Invalid input yields an
`INVALID_INPUT` item with zero attempts and does not stop intake. Invalid handler
output yields `INVALID_OUTPUT`.

Only `STAGE_EXECUTION_FAILED` and `STAGE_TIMEOUT` can retry. Retry delay is
cancellable and does not hold a stage concurrency slot. When attempts are
exhausted, `onFailure` applies:

- `dead-letter` emits a `failed` result and continues other work. It is a
  structured terminal record, not a durable external dead-letter queue.
- `drop` emits an explicit `dropped` result with its failure; nothing disappears
  silently.
- `stop` emits `failed`, stops deliberate future source intake, and lets items
  already accepted at the concurrent boundary drain to terminal results.

A source iterator exception is a run-level `SOURCE_FAILED`, never a fabricated
item. Already accepted items drain unless caller cancellation or consumer close
wins. Summary status is `cancelled` after caller cancellation/close, otherwise
`failed` for a run failure or any failed/dropped item, and otherwise
`succeeded`.

### Cancellation and scope boundary

Cancellation stops intentional intake, wakes runtime queue/retry waiters,
signals active handlers, and accounts accepted unfinished items as cancelled.
It is cooperative: JavaScript cannot preempt a synchronous source/handler that
blocks the event loop, and a handler that ignores its signal may finish an
external effect after the pipeline has detached and observed its late outcome.
Make mutating handlers idempotent using stable item/stage identity, reconcile
ambiguous effects, and isolate blocking or untrusted work in an application-
managed process/container.

This API is standalone and in-memory. It does not activate Graph IR
`edge.mode: "stream"`, alter `runGraph`'s one-result-per-node model, or persist
item identities, queues, offsets, acknowledgements, retry claims, stream joins,
windows, replay, or fork. If a graph node calls `runPipeline`, the entire
pipeline is part of that one node attempt; a crash can replay it in full, and
inner attempts do not consume the graph's `maxTotalAttempts`. Materialize only
a bounded portable-JSON result, and do not claim durable item streaming or
exactly-once effects. See the
[bounded pipeline semantics](../../spec/pipeline-semantics.md).

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

## Native bounded cycle controllers and GraphPatch

The D7 API executes explicit, bounded `until-dry`, `while`, and
`evaluator-optimizer` policies. Its event stream—not process memory or a
checkpoint—is authoritative. Every attempt claim, exact worst-case round
reservation, result, settlement, patch decision, round commit, and terminal
observation is hash chained and CAS appended.

```ts
import {
  MemoryCycleControllerEventStore,
  pauseCycleController,
  renewCycleControllerLease,
  resumeCycleController,
  startCycleController,
} from "@graph-engineering/runtime";

const eventStore = new MemoryCycleControllerEventStore();
const result = await startCycleController(request, initialGraph, {
  eventStore,
  lease,
  activities: {
    finder: async ({ input, idempotencyKey, signal }) => ({
      output: await findCandidates(input, { idempotencyKey, signal }),
    }),
    candidateEvaluator: async ({ input }) => ({
      output: await evaluateEveryFreshCandidate(input),
    }),
  },
});

// A replacement holder supplies the exact tail sequence and a strictly newer
// lease/fencing token. Use takeover only after fencing the former holder.
const resumed = await resumeCycleController(request, initialGraph, {
  eventStore,
  expectedSequence: 12,
  lease: replacementLease,
  leaseReason: "takeover",
  activities,
});

// On a separate active, nonterminal stream, lease administration is
// zero-dispatch. Renewal preserves the complete fenced identity and only
// extends its exclusive expiry; pause records a voluntary release. Both
// operations require that stream's exact current sequence.
const activeTailSequence = 12;
const activeLease = lease;
const renewed = await renewCycleControllerLease(request, {
  eventStore,
  expectedSequence: activeTailSequence,
  lease: { ...activeLease, expiresAt: "2026-07-26T12:02:00.000Z" },
});
const paused = await pauseCycleController(request, {
  eventStore,
  expectedSequence: renewed.event.sequence,
  reason: "handoff",
});
```

`replayCycleController` is read-only and dispatches no activity or clock;
`forkCycleController` binds a child to one immutable parent prefix. Checkpoints
are optional verified caches. Missing, stale, or corrupt checkpoint data never
overrides a complete event fold. `MemoryCycleControllerEventStore` and
`MemoryCycleControllerCheckpointStore` are deterministic local implementations,
not distributed lease providers.

All four public operations accept cooperative cancellation (`signal` in the
run options, including replay's fourth options argument and pause options).
Cancellation before an operation's durable commit returns
`GE_CYCLE_OPERATION_CANCELLED` with `{ operation, boundary }` and appends
nothing. After `LeaseAcquired`, resume safely writes a `CANCELLED` terminal;
after a dispatchable child's `ControllerCreated`, fork completes a child lease
plus cancelled terminal. A committed pause release or an
already completed result wins over cancellation observed at return. An open
resume round is recovery debt and is settled under a replacement lease without
handler dispatch even when the signal was already aborted.

`renewCycleControllerLease` rejects a changed holder, lease ID, epoch, fencing
token, acquisition instant, non-extending expiry, expired lease, or stale
sequence before append. `pauseCycleController` accepts only `paused` or
`handoff`, rejects expired/released/terminal leases, and appends no work. When a
checkpoint store is supplied, each administration operation writes the
`{controllerRunId}-latest` acceleration checkpoint after its event; an event
that committed remains authoritative if checkpointing fails.
If concurrent administrators present the same tail, exactly one CAS commits;
every loser returns `GE_CYCLE_VERSION_CONFLICT` without overwriting the winner.

The test/simulation surface derives its complete durable-boundary lattice from
the public event vocabulary:

```ts
import {
  buildCycleDurableFaultMatrix,
  MemoryCycleControllerEventStore,
} from "@graph-engineering/runtime";

const matrix = buildCycleDurableFaultMatrix(); // 855 event/stage/fault obligations
const eventStore = new MemoryCycleControllerEventStore({
  faultHook: (boundary) => {
    if (boundary === "store:event:DiscoveryCommitted:after-commit-before-return") {
      throw new Error("simulate commit-then-process-loss");
    }
  },
});
```

Controller `faultHook` covers construction, prospective fold, store return,
in-memory projection, checkpoint, and terminal-delivery boundaries; the memory
event-store hook covers both sides of its atomic commit. These hooks are
deterministic verification controls, not a production durability claim. The
retained fixture and Python join compare all 855 canonical entries. The first
retained behavioral campaign also executes all 100 combinations for
`LeaseRenewed` and `LeaseReleased`: ten stages by five fault kinds by two event
types. Each run proves committed-prefix validity, exact durability class,
single settlement, stale-version and stale-fence zero-write behavior, safe
resume, read-only replay, and terminal-resume zero writes.

`buildCycleOperationInterruptionMatrix()` adds the closed 25-row H03B lattice:
six pause, six resume, four replay, and nine fork boundaries. The conformance
join executes every row independently in TypeScript and Python and compares
full event bytes/hashes, appended suffixes, errors, results, handler counts,
fork parent prefixes, and pause checkpoints.

The retained H03C campaign also executes 35 `PatchAccepted` visibility faults:
seven stages from before event construction through after state update crossed
with all five fault kinds. In the 20 pre-commit rows, recovery reuses the same
stable activity key and may rerun only the idempotent planner. In the 15
committed rows, stored patch bytes rebuild revision 2 with zero planner
reinvocation. Every row ends with one accepted decision, one budget settlement,
one round commit, read-only replay, and zero-work terminal resume; TypeScript
and Python compare the complete events, hashes, result, and checkpoint. The
H03D campaign adds all 15 checkpoint-stage combinations: three checkpoint
boundaries crossed with five fault kinds. With `checkpointEveryEvents: 1`, the
two pre-save boundaries retain the immediately prior valid prefix checkpoint,
while the post-save boundary retains the exact `PatchAccepted` checkpoint.
Every row restores revision 2 from the event stream without rerunning the
planner and finishes with an exact terminal `-latest` checkpoint; Python and
TypeScript compare checkpoint lag, write count, complete events, hashes, result,
and final stored checkpoint.

When replaying or resuming a fork in a fresh process, replay the exact parent
event prefix locally and pass that verified fold as `parent`. A serialized or
caller-constructed fold object is not accepted as inheritance authority: its
history hash may name a real prefix while its copied counters or seen set lie
about what that prefix contains.

`NativeGraphPatchApplier` accepts append-only nodes, edges, and outputs. It
validates closed authority/budget context, stale-base CAS, capability ceilings,
graph limits, and complete compilation before producing a revision. Call
`prepare`, durably append its decision, then `commitPrepared`; exact retries
return the originally frozen decision/application, while a reused patch ID with
different canonical bytes fails closed. External side effects remain
at-least-once and require idempotency or explicit approval. See
[cycle semantics](../../spec/cycle-semantics.md).

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

Edge `condition`/`map`, JSON Schema I/O validation, Graph IR streaming edges,
scheduler checkpoint acceleration, distributed workers, and distributed leases
are intentionally scheduled for later alphas. The standalone bounded-pipeline
API above does not silently implement those graph or durable-stream surfaces.
