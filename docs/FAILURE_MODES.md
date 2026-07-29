# Failure modes and mitigations

Graph orchestration does not remove failure. It makes failure domains, retry
boundaries, and recovery decisions explicit enough to test. This document covers
both failures handled by the current alpha and failures the target-v1 design
must handle.

## Status and guarantees

The TypeScript and Python runtimes provide an ordinary in-memory DAG scheduler,
separate event-sourced start/resume operations, and a standalone bounded-pipeline
API. They also provide a separate alpha bounded-cycle/GraphPatch controller with
exact event-fold recovery, replay, fork, and cross-language byte conformance.
Both native implementations pass shared ready-queue, durable-recovery,
pipeline, and native-cycle cases, bound concurrency/attempts, preserve
structured failures, and expose cooperative cancellation. Graph inputs, node
results, and pipeline items must be detached portable finite JSON.

Durable runs write authoritative scheduler events and reconstruct continuation
from the complete event history. They bind graph, original input, and
caller-supplied implementation identity, reuse committed successes, preserve
consumed attempt budgets, and make terminal resume side-effect free. Standalone
checkpoint stores exist, but scheduler checkpoint acceleration does not. Replay,
fork, and append-only dynamic patches exist only on the standalone controller;
production controller stores/fencing, ordinary-scheduler dynamic revision
integration, Graph IR-integrated or durable item streaming, arbitrary condition
expressions, durable route-decision identity, verifier panels, provider rate
limiting, and worktree isolation remain future work. The current schedulers do
execute the closed compiler-validated `RouteEquals` condition and apply a
fail-closed `runtime-capability/v1alpha1` preflight before ordinary work or
durable store I/O. That gate prevents unimplemented Graph IR vocabulary from
silently degrading; it is not a complete capability/security policy engine. The current pipeline is a
lazy single-consumer in-memory API, not durable graph streaming. Sections marked
**target v1** are operational requirements, not current claims.

## Failure is data

Neither runtime turns a failed node into `null`. A run returns:

- a graph status (`succeeded`, `failed`, or `cancelled`);
- deterministic node results with `succeeded`, `failed`, or `skipped` status;
- a structured failure list;
- attempt counts and observed concurrency;
- output only when every named output can be bound.

Current execution failures include:

| Code | Meaning | Normal response |
| --- | --- | --- |
| `EXECUTOR_NOT_FOUND` | No node- or kind-level executor is registered | Fix configuration; do not retry unchanged |
| `NODE_EXECUTION_FAILED` | Executor threw or rejected | Retry only when the cause is transient and the effect is safe |
| `NODE_TIMEOUT` | Attempt exceeded `timeoutMs` | Inspect executor cancellation and external effect state before retry |
| `NODE_CANCELLED` | Run cancellation reached the attempt or prevented launch | Preserve as cancellation; do not relabel as provider failure |
| `INVALID_OUTPUT` | Handler returned a value that is not portable finite JSON | Fix/serialize the output; retrying unchanged is unsafe |
| `UPSTREAM_FAILED` | A required producer did not succeed | Repair or retry upstream; the skipped node has not executed |
| `INPUT_BINDING_FAILED` | A selected source port is absent or two edges collide on an input key | Fix edge endpoints/ports; do not retry unchanged |
| `ATTEMPT_BUDGET_EXHAUSTED` | The run-wide attempt budget was consumed | Raise a reviewed budget or reduce retries/work; never loop automatically |
| `OUTPUT_BINDING_FAILED` | A named graph output or output port cannot be assembled | Fix the output contract or producer result |
| `UNSUPPORTED_RUNTIME_CAPABILITY` | Compiler-valid Graph IR requests runtime behavior outside the closed alpha subset | Remove the declaration or use a runtime that implements its exact contract; no node was attempted |
| `UNSUPPORTED_EDGE_CONDITION` | A registered condition other than the integrated `RouteEquals` family reached this scheduler | Use the supported routing family or a controller that owns the condition; no node was attempted |

Compiler failures are returned before executors run. Stable codes cover invalid
Graph IR, duplicate IDs, missing endpoints, cycles, unreachable nodes, invalid
entrypoints/outputs, entrypoints with incoming edges, and fan-out/depth policy
violations. Run `graph validate <file> --json` to obtain the exact diagnostic and
location.

## Topology failures

### Fake ordering serializes independent work

**Symptom:** Wall time approximates the sum of jobs that could have overlapped.

**Cause:** An edge was added because one instruction was written after another,
not because the second consumes the first output.

**Mitigation:** Name the value that crosses every edge. Delete the edge when no
value, artifact reference, route decision, or explicit control policy crosses.
Use separate entrypoints or fan-out from a shared scoping node. Measure critical
path rather than counting steps.

### An implicit layer barrier stalls a ready descendant

**Symptom:** A fast branch finishes, but its next node waits for an unrelated slow
sibling in the same visual/topological layer.

**Cause:** The executor treats compiler layers as synchronized batches.

**Mitigation:** Schedule from per-node dependency counts. Both native runtimes use
a ready queue: a descendant starts when its own inputs are
ready and a slot is free. Preserve the shared `runtime-ready-queue` conformance
case when changing scheduler code. Add a barrier only where cross-branch data is
actually required.

### False independence corrupts shared resources

**Symptom:** Two “parallel” nodes overwrite the same file, reuse a port, mutate a
shared cache, or race on one database record.

**Cause:** There is no data edge, but there is an undeclared resource dependency.

**Current mitigation:** Do not run those executors concurrently unless the
application supplies locking or isolation. Encode a real ordering edge if the
resource is necessarily serial.

**Target-v1 mitigation:** Declare resource leases and isolation scopes. Give file
writers separate worktrees; allocate unique temp/cache/port/database namespaces;
merge through an explicit tested node. “No data edge” never means “no shared-state
risk.”

### A barrier waits for more than it needs

**Symptom:** Fan-in latency is determined by the slowest source even though a
usable decision requires only a subset.

**Cause:** An all-input dependency was chosen for code simplicity.

**Current boundary:** Alpha supports normal all-dependencies readiness. It
does not implement quorum or deadline barriers.

**Target-v1 mitigation:** Declare `all`, count, percentage, quorum, and deadline
semantics explicitly. Preserve the settled status of every item. On insufficient
quorum, return `unknown` or escalate; never manufacture success from missing data.

### A graph contains an implicit cycle

**Symptom:** No node in a strongly connected component can become ready.

**Current mitigation:** Compilation fails with `GE1005_CYCLE`; no executor runs.

**Bounded repetition:** Keep ordinary Graph IR acyclic and use the standalone
bounded controller for an explicit `until-dry`, `while`, or
evaluator-optimizer request with hard iteration, duration, attempt, discovery,
dynamic-node, and cost limits. Do not bypass the compiler with hand-written
recursive spawning. Production distributed fencing and ordinary-scheduler
GraphPatch integration remain follow-up controls.

## Contract and binding failures

### Producer and consumer disagree on shape

**Symptom:** A downstream executor fails while reading a field, or a named port is
missing.

**Cause:** The declared output/input schemas and the actual executor values have
drifted.

**Current boundary:** Graph IR structure is validated at compile time, and named
port selection failures are structured. The alpha runtime does **not** yet
validate every node input and output against JSON Schema.

**Mitigation now:** Validate inside custom executors, use typed fixtures, and test
the real edge payload. Do not assume that merely declaring a schema enforces it at
runtime.

**Target-v1 mitigation:** Validate node input before execution and output before
the success record becomes visible. A schema mismatch is a node failure and must
not release dependants.

### Two edges bind the same input key

**Symptom:** `INPUT_BINDING_FAILED` before the consumer executor starts.

**Cause:** Multiple incoming edges use the same `to.port`, or omit `to.port` while
sharing a source ID/key.

**Mitigation:** Give each input a unique target port. Target v1 may allow an
explicit reducer contract; until such a contract exists, never depend on
last-write-wins behavior.

### Entrypoint input is ambiguous

**Symptom:** A node is declared as an entrypoint but also receives an incoming
edge.

**Mitigation:** The compiler reports `GE1010_ENTRYPOINT_HAS_INCOMING`. Make the
node a true root that consumes graph input, or remove it from `entrypoints` and
feed it only from upstream. Do not choose one input source at runtime.

### A graph output is not a sink

**Symptom:** The caller expects the “last node” but receives a different or absent
value.

**Cause:** Output was inferred from array order or graph shape.

**Mitigation:** Bind every public output by name in `GraphSpec.outputs`. If an
output uses a port, test that property. The runtime does not infer a sink.

## Execution and retry failures

### Retrying duplicates an external side effect

**Symptom:** Duplicate email, payment, ticket, commit, or API mutation appears
after a timeout, transient error, or crash.

**Cause:** The orchestrator cannot know whether the external operation succeeded
before the response was lost. External effects are not atomically committed with
local state.

**Mitigation:** Treat external activities as at least once. Generate one stable
idempotency key for the logical activity and reuse it across attempts. Query the
external system before retrying an ambiguous result. Mark truly non-idempotent
nodes and require review or approval on recovery.

The ordinary in-memory scheduler treats `sideEffects` as descriptive metadata.
Durable resume uses it only to decide whether an open, unknown-outcome attempt
may be invoked again: `none` and `idempotent` are eligible within the original
budgets, while an omitted or `non-idempotent` declaration fails closed with
`IN_DOUBT_SIDE_EFFECT`. This policy cannot prove that an external operation is
actually idempotent, and there is no approval callback.

### Timeout does not terminate executor code

**Symptom:** The scheduler records `NODE_TIMEOUT`, but the underlying request or
process continues and may later produce a side effect.

**Cause:** JavaScript cancellation is cooperative. The runtime aborts the signal
given to the executor and races the attempt against a timer; it cannot forcibly
stop arbitrary code that ignores the signal.

**Mitigation:** Executors must pass `signal` to fetches, subprocess controls, and
provider SDKs; clean up in `finally`; and make effects idempotent. For untrusted or
non-cooperative work, use a killable process/container boundary when that target
v1 isolation provider exists. Do not immediately retry a timed-out mutating call
without reconciling its external state.

### Cancellation is mistaken for rollback

**Symptom:** A run is cancelled, but already completed or non-cooperative active
work remains visible.

**Cause:** Cancellation prevents future useful work and signals active executors;
it does not undo completed effects.

**Mitigation:** Define compensating actions separately, make them explicit graph
nodes, and audit their own failure modes. TypeScript executors must honor
`AbortSignal`; Python handlers must honor their `CancellationSignal`. Report
cancellation distinctly from failure so operators do not assume rollback.

### Retries consume the whole run budget

**Symptom:** Later nodes receive `ATTEMPT_BUDGET_EXHAUSTED` even though their own
retry limit was not reached.

**Cause:** Earlier failures consumed `policies.maxTotalAttempts`.

**Mitigation:** Budget from worst-case topology: initial attempts plus allowed
retries on the critical failure paths. Apply low per-node bounds to noisy work.
Increase the global budget only after understanding the cause; a higher ceiling
is not a convergence strategy.

### Retry storms amplify provider failure

**Symptom:** Rate limits and latency worsen as many branches retry together.

**Current boundary:** Node retry backoff is bounded, but provider-wide rate
limiting, jitter coordination, and circuit breakers are not implemented.

**Mitigation now:** Keep concurrency and attempts low in application configuration.
Use provider SDK rate limits and randomized delay in executors where necessary.

**Target-v1 mitigation:** Centralize provider/resource-group concurrency, rate
limits, jitter, retry-after handling, and circuit breaking. A breaker-open result
is structured and should route to fallback or pause, not trigger more fan-out.

## Standalone bounded-pipeline failures

The current `runPipeline`/`run_pipeline` APIs are standalone, bounded, and
single-pass. They do not use graph node statuses or graph failure codes. Every
accepted item has a terminal result, while failures that occur before a source
value is accepted belong to the run summary.

| Pipeline code | Scope | Meaning |
|---|---|---|
| `INVALID_INPUT` | Item | The accepted source value could not be snapshotted as portable JSON |
| `STAGE_EXECUTION_FAILED` | Item/stage | A handler threw, rejected, or cancelled itself without pipeline cancellation |
| `STAGE_TIMEOUT` | Item/stage | The configured attempt timer won |
| `INVALID_OUTPUT` | Item/stage | A handler returned a non-portable JSON value |
| `ITEM_CANCELLED` | Item/stage | Caller cancellation or consumer close prevented completion |
| `SOURCE_FAILED` | Run | Iterator creation or iteration failed; no item is fabricated for the failed pull |
| `ITEM_LIMIT_REACHED` | Run | Exactly `maxItems` values were accepted, so intake stopped without another pull |

A terminal item failure has `retryable: false`: if another attempt had been
allowed, it would already have happened before the terminal result committed.

### Source failure is confused with item failure

**Symptom:** A source yields a valid prefix and then throws, but an operator
looks for a failed item at the next index.

**Behavior:** The prefix is already accepted and drains to item results. The
summary records `runFailure.code: "SOURCE_FAILED"`; the failed source pull has no
`itemIndex` because it did not produce an accepted item. A source-iterator
factory failure is the same run-level class and starts no handler.

**Mitigation:** Inspect both item results and `PipelineSummary.runFailure`. Keep
source acquisition idempotent where possible. A failure raised only by the
source's `return()` cleanup hook is observed for diagnostics but does not
replace the first run failure or explicit consumer close.

### An invalid item is silently treated as null

**Symptom:** A sparse array, cycle, bigint, non-finite number, unsafe integer,
class instance, or other non-portable value enters the source.

**Behavior:** Admission has already assigned an index and consumed the item
budget. Snapshot failure emits a `failed` item with `INVALID_INPUT`,
`inputBound: false`, zero stages, and zero attempts; intake continues. Valid JSON
`null` has `inputBound: true` and remains ordinary data. Source values and stage
outputs are detached before a later pull or downstream release, so caller-owned
mutation cannot rewrite accepted work.

**Mitigation:** Validate/serialize at the source boundary, but keep the
structured item result as the audit record. Never collapse `inputBound: false`
and a bound `null` input into one representation.

### The item budget unexpectedly fails a finite run

**Symptom:** A source believed to contain exactly `maxItems` values produces all
those results and still ends with `ITEM_LIMIT_REACHED`.

**Cause:** The producer checks the hard budget before another source pull. It
does not peek past the limit to distinguish an exhausted source from an infinite
one.

**Mitigation:** For a known finite source, configure `maxItems` strictly above
the expected count. Treat the limit as a run failure, retain the drained item
results, and do not add a diagnostic “one extra pull” that could trigger more
unbounded or side-effecting source work.

### An unbounded stage generator blocks configuration

**Symptom:** Constructing a pipeline never returns because its stage iterable
does not terminate.

**Behavior:** `maxStages`/`max_stages` defaults to the protocol hard maximum of
2048 and can be lowered. Construction inspects at most that many accepted stage
declarations plus one overflow value, then rejects synchronously before reading
the overflow stage's properties, constructing the item-source iterator, or
calling a handler.

**Mitigation:** Use a finite stage collection and set the stage budget near the
expected topology size. This bound limits the number of iterator pulls; it
cannot preempt one hostile synchronous `next()` call or property getter that
itself never returns. Isolate untrusted configuration producers in a process.

### Stop, drop, and dead-letter are collapsed together

The failure policy applies after a stage failure can no longer retry:

- `dead-letter` emits `failed`, prevents that item from entering downstream
  stages, and lets source intake and other items continue. It does **not** write
  a durable or external dead-letter queue; the returned terminal result is the
  record.
- `drop` emits `dropped` with its failure and prevents downstream work. Drop is
  explicit, never silent disappearance.
- `stop` emits `failed`, requests source intake to stop, and lets every item
  already accepted at the concurrent boundary drain. Up to `maxInFlight` items
  may already belong to that accepted set; they must not be discarded merely
  because a sibling stopped intake.

Any failed or dropped item makes a normally drained summary `failed`. Caller
cancellation/consumer close has higher summary-status precedence. Stage policy
does not apply to `SOURCE_FAILED`, which is a run-level condition.

### A retry repeats an external effect

Only `STAGE_EXECUTION_FAILED` and `STAGE_TIMEOUT` can retry, and only while the
bounded `maxAttempts` budget remains. `maxAttempts` includes the first attempt.
Invalid input, invalid output, and pipeline cancellation never retry. Queue wait
does not consume the stage timeout; the timer starts immediately before handler
invocation. Retry delay is cancellable and does not occupy a stage concurrency
slot.

Pipeline retries are in-memory at-least-once attempts. The API has no durable
retry claim and no exactly-once effect boundary. A mutating handler should derive
an application idempotency key from stable run/item/stage identity and reuse it
across attempts, reconcile an ambiguous timeout before retrying, and ignore the
attempt number when identifying the logical effect. A graph-node wrapper does
not change this rule.

### Input ordering is mistaken for a stage barrier

**Symptom:** A fast later item completes internally but is not returned while a
slow earlier item is still running.

**Cause:** The default `ordering: "input"` holds terminal delivery in index order.
It does not prevent the later item from entering downstream stages. Switching to
`"completion"` changes terminal delivery only; it still does not serialize or
reorder internal side effects.

**Mitigation:** Choose output ordering for the consumer contract, not as a
concurrency control. Use gates/probes rather than sleep timing to test that a
fast item entered the next stage before the slow sibling finished.

### Completion waits while the consumer is idle

**Symptom:** Handlers appear finished, but `run.completion` remains pending.

**Cause:** Global in-flight credit is held until a terminal result is returned to
the consumer. An open consumer that stops reading can fill the bounded
result/reorder buffer; automatically collecting an unbounded output array just
to resolve completion would violate end-to-end backpressure.

**Mitigation:** Naturally drain the iterator before awaiting completion, or call
`close()`/`aclose()` when stopping early. Input-order head-of-line blocking is
bounded by `maxInFlight`; stage queues are bounded by `bufferCapacity`.

### Cancellation is mistaken for preemption or rollback

Caller cancellation or consumer close stops intentional source intake, wakes
runtime queue/retry waiters, signals active handlers, and settles accepted
non-terminal items as `cancelled`. No new handler attempt starts after
cancellation is observed. Cancellation before the first read creates no source
iterator and performs no pull.

Cancellation remains cooperative. It cannot undo completed effects, and it
cannot forcibly stop arbitrary JavaScript/Python code, a request, or a process
that ignores the supplied signal. Reconcile or compensate external state
explicitly; do not report cancellation as rollback.

### Early exit abandons cleanup

In TypeScript, breaking a `for await` loop calls iterator `return()`, which
delegates to idempotent `close()`. Code that calls `next()` manually must call
`close()` in `finally`. In Python, use the pipeline async context manager or call
`aclose()` in `finally`; breaking an arbitrary custom async iterator does not
portably invoke it.

Explicit close accounts all accepted work in the summary even when the consumer
did not receive every terminal record, so `emitted` may be smaller than
`accepted`. It also wakes a pending consumer read and must settle completion
without more reads. Merely dropping a run object or consumer task is not a
portable cleanup guarantee.

### Non-cooperative source or handler outlives the pipeline

A synchronous source or handler can block its event-loop thread; the runtime
cannot observe cancellation until control returns. An asynchronous handler that
ignores its attempt signal may also complete an external effect after timeout or
cancellation. The pipeline detaches and observes a late outcome to avoid an
unhandled rejection, but observing it cannot retract the effect. A source that
ignores its close/return hook may likewise finish its pending operation later.

Use cooperative asynchronous APIs, pass the signal through every provider/tool
call, release application resources in `finally`, and isolate blocking or
untrusted work in a killable process/container when the application provides
one. The pipeline cleans up runtime-owned producers, workers, waiters, timers,
and listeners; it cannot clean up arbitrary tasks spawned and abandoned by user
code. Process/container providers are not supplied by this current alpha.

### A standalone pipeline is mistaken for durable stream execution

`edge.mode: "stream"` remains declarative and `runGraph` still consumes one
terminal value per upstream node. The standalone pipeline persists no item ID,
queue content, offset, acknowledgement, retry claim, stream join/window, replay,
or fork state. Calling it inside a graph node makes the complete pipeline part of
one node attempt: a crash can replay the whole pipeline, and its inner attempts
do not consume the graph's `maxTotalAttempts`.

Materialize only a bounded portable-JSON node output, include inner retry cost in
the application budget, and never describe this boundary as durable item
streaming or production-ready exactly-once processing.

## Failure containment mistakes

### One failed branch aborts unrelated work

**Symptom:** A source failure prevents an independent source from completing.

**Cause:** A batch-wide rejection or fail-fast primitive is used where partial
settlement was intended.

**Current behavior:** Both native runtimes record the failed node, skip its
descendants, and continues independent ready branches. The overall run still
fails if named outputs cannot be assembled.

**Mitigation:** Keep branch-local failures local. At fan-in, explicitly decide
whether all, partial, or quorum results are acceptable. Never erase which inputs
failed.

### A skipped node is treated as an attempted failure

**Symptom:** Operators retry a consumer even though its executor never ran.

**Cause:** `skipped`/`UPSTREAM_FAILED` was collapsed into `failed`.

**Mitigation:** Repair or rerun the producer first. Preserve node status and
`upstreamNodeIds`. A skipped node has zero attempts and no external effect of its
own.

### A partial result is presented as complete

**Symptom:** A report omits a failed source without disclosing the omission.

**Mitigation:** Carry completeness metadata through fan-in. Target-v1 partial and
quorum barriers must expose failed, timed-out, absent, and successful inputs. A
writer may summarize partial evidence only when the output contract and user
presentation say so.

## Judgment failures (target v1)

The following topologies are not yet implemented as runtime policies, but their
failure semantics must be designed before implementation.

### Router emits an unknown or low-confidence class

- Require a validated enum rather than free text.
- Make routes exhaustive or declare a fallback.
- Route low confidence to a human or safe handler.
- Record the classification and chosen edge so replay does not reclassify.
- Never let model text directly grant tools, paths, network, or secrets.

### Verifiers share the same blind spot

- Use genuinely different rubrics or evidence sources, not repeated identical
  prompts.
- Keep maker and verifier contexts separate.
- Give verifiers original evidence, not only the maker's summary.
- Preserve pass, reject, and abstain votes.
- Treat insufficient quorum as unknown.
- Include deterministic tests wherever possible; majority agreement is not proof.

### A verifier failure is counted as rejection or approval

Provider timeout, schema failure, or unavailable evidence is `unknown`, not a
vote. Barrier policy decides whether to retry, degrade, or escalate. Converting a
technical failure into a verdict biases the panel.

### Discovery loop never runs dry

Deduplicate new candidates against the full `seen` set, including rejected and
unknown candidates. Otherwise rejected items reappear forever. Require dry-round
convergence and hard limits. Persist `seen` before the next discovery iteration in
the eventual durable implementation.

### Evaluator/optimizer oscillates

Track rubric score and artifact hash. Stop on threshold, no improvement, repeated
state, budget, or iteration limit. Do not equate “different output” with progress.

## Durable execution failures

### Crash after effect, before the durable outcome

The external effect may exist after `NodeStarted` commits while the event stream
still has no attempt outcome. Resume records the interrupted attempt as consumed.
It may retry a node declared `sideEffects: "none"` or `"idempotent"`; idempotent
attempts receive the same stable activity key. For omitted or non-idempotent
declarations it throws `IN_DOUBT_SIDE_EFFECT` without invoking the executor
again. Applications must still forward the key, reconcile ambiguous remote
state, and authorize any compensation. External exactly-once execution is not
provided.

### Crash after one branch succeeds

The current durable scheduler commits each validated `NodeSucceeded` together
with its ordered outgoing `EdgeEmitted` facts before releasing dependants. Resume
reuses that result and schedules only unfinished work; it does not wait for an
entire visual layer or barrier before persisting progress.

### Two orchestrators resume one run

The current continuation claim appends `RunResumed` with compare-and-swap before
calling an executor, so competing resume calls cannot both commit that claim.
CAS is not a lease or fencing token: an old coordinator or two processes may
still execute external work before one loses a write race. Ensure the old
coordinator has stopped before resume. A lease/fencing provider that stops stale
owners is target-v1 work.

### Code or graph changes during resume

Current start binds each run to graph revision/hash, original input hash, and a
hash of the caller-supplied `implementationId`; resume rejects mismatches before
invoking executors. The implementation ID is a caller assertion, not code
attestation. Replay or fork under changed code is not implemented and must
eventually be an explicit operation rather than an invisible upgrade.

### Checkpoint is mistaken for truth

The append-only event history is the current source of truth and resume folds it
in full. Local checkpoint adapters are not connected to scheduler recovery, so a
checkpoint cannot authorize or change continuation. Future checkpoint
acceleration must validate its history position and projection, ignore stale or
corrupt caches, and remain rebuildable from events.

### Terminal resume repeats completed work

A valid terminal history is idempotent in both native runtimes: resume returns
the recorded graph result with zero new events, zero checkpoint writes, and zero
executor calls. A terminal snapshot that contradicts folded node history is
`INVALID_RUN_HISTORY`, not a reason to trust the snapshot or rerun work.

## Security and isolation failures

### Parallel writers collide

Current custom executors share a process and filesystem unless the application
isolates them. Serialize conflicting work now. Target v1 assigns worktrees or
other isolated namespaces and merges only after tests and policy checks. A merge
conflict is a structured failure, never permission to overwrite.

### Model or tool output expands authority

Treat every prompt, model response, repository file, webpage, and tool response as
untrusted data. Target-v1 capability policy is fixed outside model output; dynamic
graph patches must pass compilation, budget, and authorization again. See
[Security](./SECURITY.md).

### Secrets leak through traces or artifacts

The alpha runtime has no telemetry exporter, but node inputs and outputs are
present in the returned in-memory result and application code can still log them.
Do not put raw secrets in Graph IR or model prompts. Target v1 redacts before
persistence/export, defaults payload capture off, and injects scoped secret
references only at the executor boundary.

## Triage checklist

When a run fails:

1. Validate the exact immutable graph and record its hash.
2. Separate compile, execute, output-binding, cancellation, and policy failures.
3. Identify whether the node ran; `skipped` is not an attempted side effect.
4. Inspect attempt number, retryability, timeout, and total-attempt budget.
5. Check independent branches before rerunning the whole graph.
6. For any external mutation, reconcile remote state before retrying.
7. Check whether the executor honored cancellation and whether background work
   still exists.
8. Reduce to deterministic mock executors and reproduce topology separately from
   provider behavior.
9. Add the smallest fixture that proves dependency, ordering, and failure-domain
   expectations.
10. Record the root cause and budget/policy change; do not close an incident with
    “retry succeeded” alone.

## Do not retry unchanged when

- the compiler rejects graph structure or policy;
- an executor is not registered;
- an input/output port or binding contract is wrong;
- a non-idempotent effect has an ambiguous remote outcome;
- a hard budget or convergence limit was reached;
- authorization or capability policy denies the action;
- a verifier reports a deterministic reproduction of the defect.

Retry is appropriate only when the failure is plausibly transient, the attempt is
within a bounded policy, and repeating the activity is safe.

## Related documentation

- [Concepts](./CONCEPTS.md)
- [Security architecture](./SECURITY.md)
- [Current runtime boundary](../packages/runtime/README.md)
- [Portable runtime semantics](../spec/runtime-semantics.md)
- [Standalone bounded-pipeline semantics](../spec/pipeline-semantics.md)
