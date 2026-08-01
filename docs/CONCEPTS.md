# Graph Engineering concepts

Graph Engineering is the practice of expressing agent work as explicit jobs and
data dependencies, then giving the orchestration layer deterministic control over
readiness, concurrency, failure, and recovery. A graph is useful because it says
*why* one job must wait for another. It is not a decorative way to draw a list of
prompts.

## Read this status boundary first

This repository is **alpha**. The concepts in this document include both
behavior that exists today and the intended v1 architecture.

| Area | Current alpha | Target v1 |
| --- | --- | --- |
| Portable format | Versioned JSON Graph IR, canonical hash, compiler diagnostics, conformance fixtures | Stable compatibility and migration policy |
| Native runtimes | TypeScript and Python IR, compilers, ready-queue schedulers, standalone bounded pipelines, and protected event-sourced start/resume pass shared conformance cases; APIs remain unstable | Distributed execution and a broader cross-language conformance corpus |
| Topologies | DAG fan-out/fan-in; standalone per-item pipelines with bounded buffers/backpressure; deterministic settled all/minimum/percentage evaluation; compiler-validated `RouteEquals` routing in both ordinary and durable schedulers; scheduler-executed integrated barriers in TypeScript only; TypeScript constructors for diamonds, verifier fan-out, routing, and finite loop expansion | Graph-integrated/durable item streaming, integrated barriers in the Python scheduler, verifier policies, subgraphs, and dynamic bounded loops |
| Adapters | Deterministic mock, generic HTTP with an injected transport, and a shell adapter that refuses to execute — all in both languages, behind declared capabilities and preflight refusal | Provider clients, MCP client adapters, and live-provider evidence |
| Persistence | Native local event stores drive scheduler start/resume from authoritative history, with mandatory payload protection; atomic checkpoint stores exist separately but do not accelerate the scheduler | Checkpoint acceleration, scheduler replay/fork, leases, artifact stores, and production databases |
| Security | Sink-before-write redaction and mandatory durable payload protection; graph bounds and a trusted `sideEffects` declaration gate ambiguous durable retries; executors still have ambient process authority | Enforced capabilities, worktree/process/container isolation, approval gates, and policy-audited dynamic graphs |

“Target v1” is a design commitment, not a claim that the feature is already
available. See the [runtime package status](../packages/runtime/README.md) for the
current executable boundary and the [protocol specification](../spec/README.md)
for portable contracts.

## Nodes are jobs; edges are data dependencies

A **node** is one bounded job with an explicit input and output contract. A node
may eventually be backed by deterministic code, a model, a tool, a human approval,
or a nested graph. A well-designed node has one reason to change and produces a
shape that downstream code can validate.

An **edge** says that a downstream node consumes something produced by an upstream
node. The edge is a data contract, not a synonym for “and then.”

Consider two requests:

```text
summarize(report) -> publish(summary)
```

`publish` consumes the summary, so the edge is real. By contrast:

```text
summarize(report) -> check_weather(city)
```

The weather lookup does not consume the summary. The arrow is fake ordering. The
two nodes should normally be independent roots or children of a shared scoping
node:

```text
          ┌─ summarize(report)
scope ────┤
          └─ check_weather(city)
```

The practical audit is simple: for every apparent arrow, name the exact value or
control policy that crosses it. If no value, artifact reference, decision, or
explicit policy crosses, remove the edge. Incidental source-code order, shared
prose context, and “it reads more cleanly this way” are not data dependencies.

### Data edges are explicit in Graph IR

The current Graph IR gives each node `inputSchema` and `outputSchema`, and each
edge names `from` and `to` endpoints. An endpoint may select or bind a `port`.
Named graph `entrypoints` consume graph input, and named graph `outputs` make the
public result explicit. Array order never chooses the output.

The current native runtimes bind every non-entry node input as a mapping:

- the key is `edge.to.port` when present;
- otherwise the key is the source node ID;
- `edge.from.port` selects a property from the source output;
- two edges binding the same key are a structured input-binding failure.

Runtime enforcement of each node's declared input/output JSON Schema, and edge
`map` execution, are target-v1 behavior; the alpha schedulers do not silently
pretend to enforce them.

## Deterministic plumbing, probabilistic judgment

Use ordinary code for operations with one mechanically correct result: flattening,
sorting, filtering, hashing, applying a mapping, checking a schema, or deduplicating
by a stable key. Use a model where judgment is genuinely required: classifying
risk, challenging a claim, comparing trade-offs, or synthesizing an explanation.

This separation matters for four reasons:

1. deterministic operations are cheap and replayable;
2. their failures are easier to diagnose;
3. models receive smaller, bounded contexts;
4. recorded model/tool activities define a clear determinism boundary.

Calling an agent to “combine” results is appropriate when combination requires
judgment. Calling one to concatenate arrays is paying model cost for an edge.

## The adapter boundary is declared before it is used

A node that needs a model or a tool reaches a provider through an adapter, and an
adapter is four ordered layers: declaration, preflight, dispatch, normalization.
Only the dispatch layer differs between kinds.

The descriptor is the declaration. It names capabilities, bounds, a retry policy,
a circuit policy, a side-effect class, and any network, process, or MCP profile.
Preflight refuses everything the descriptor does not authorize *before* any
external effect, so a refused call performs zero provider requests, zero usage,
and zero ledger writes, and no request shape can reach an undeclared capability.
A refusal is a value with a closed error code, not a thrown provider exception,
and it never quotes a prompt — the preflight view of a request deliberately
carries no payload content.

Three adapters ship today, in both languages:

- **`mock`** is the deterministic reference and the only kind the candidate gate
  uses. It reads no clock, opens no socket, spawns no process, and needs no
  credential; every observable is a function of its descriptor, its script, and
  the request.
- **`http`** is a generic tool adapter whose transport is injected. There is no
  default `fetch` and no import of a host HTTP module, so it cannot silently
  acquire network access.
- **`shell`** constructs and authorizes a process launch and then refuses to
  perform it, because no isolation provider exists.

No OpenAI, Anthropic, or Gemini client exists here. Those kinds name intended
boundary shapes in the contract; no request has ever been sent to any of them by
this code. See [adapter semantics](../spec/adapter-semantics.md).

## Readiness is local, not layer-wide

A compiler can draw topological layers, but layers do **not** imply runtime
barriers. There is no implicit layer barrier. The alpha TypeScript and Python
schedulers use a ready queue:

1. a node becomes ready when all of *its own* incoming dependencies settle;
2. it starts when a concurrency slot is available;
3. completion releases only its direct dependants;
4. an unrelated slow node does not block a ready descendant on another branch.

For example:

```text
root ─┬─ fast ─ after-fast ─┐
      └─ slow ──────────────┴─ merge
```

If `fast` finishes while `slow` is running, `after-fast` may start immediately.
Waiting for the entire `{fast, slow}` topological layer would create an implicit
barrier and waste a concurrency slot. The shared ready-queue conformance case in
`spec/conformance/` tests this exact behavior.

Scheduling order remains deterministic when several nodes become ready together:
the Graph IR node declaration order is the tie-breaker. Completion order may vary.
Returned node results retain stable compiler order so callers do not accidentally
depend on timing.

## Core topology vocabulary

### Parallel fan-out and fan-in

Fan-out creates several independent jobs from one upstream result. Fan-in gathers
their outputs at a node that actually needs the set.

```text
             ┌─ source-a ─┐
scope/split ─┼─ source-b ─┼─ reduce/synthesize
             └─ source-c ─┘
```

The current native schedulers execute ready branches concurrently up to the
smaller of the graph policy and caller concurrency limit. Failures remain
structured; a failed branch does not become `null`. Independent branches can
finish, while descendants of a failed branch are skipped.

### Pipeline

A pipeline streams each independent item through successive stages without a
global collection barrier. Item A can be in stage three while item B remains in
stage one. Pipelines reduce tail latency when downstream processing does not need
the complete cross-item set.

The current TypeScript and Python runtimes implement this as a **standalone**
bounded-pipeline API, separate from graph execution. A run has a synchronous or
asynchronous source, an immutable ordered stage list, bounded queues between
stages, and a global in-flight credit window. Credit is acquired before a source
pull and held until the consumer receives that item's terminal result. A slow
consumer therefore propagates pressure through the bounded result/reorder
buffer, stage queues, and source rather than accumulating an unbounded result
array.

Stages remain ordered for one item, but a successful item enters the next stage
as soon as queue capacity and a stage slot are available; it does not wait for
the other items in its current stage. Per-stage `concurrency` bounds active
handler attempts. Terminal `ordering: "input"` may hold a later completed result
behind an earlier one, while `ordering: "completion"` exposes committed terminal
order. Neither option serializes internal stage execution, downstream work, or
side effects.

Every accepted item has a structured `succeeded`, `failed`, `dropped`, or
`cancelled` result. `drop` is explicit, `dead-letter` is an in-memory failed
terminal record rather than a durable external queue, and `stop` ends deliberate
source intake while already accepted items drain. JSON `null` remains data, not
a failure sentinel. Item count, in-flight work, queue depth, concurrency, retry
attempts, timeout, and computed total attempts all have hard bounds.

This does not change Graph IR execution. Graph IR stream mode remains declarative:
`edge.mode: "stream"` does not make `runGraph` lower stream edges into queues;
it still waits for one terminal result per upstream node. There are no durable item identities,
offsets, acknowledgements, queue snapshots, stream joins/windows, replay, or
fork. If a graph node calls the standalone API, the complete pipeline belongs to
that single node attempt and may rerun in full after a crash. See the
[runtime pipeline API](../packages/runtime/README.md#standalone-bounded-pipeline)
and [bounded pipeline semantics](../spec/pipeline-semantics.md).

### Barrier

A barrier is justified when a decision needs multiple upstream outcomes together:
cross-source deduplication, ranking, a complete comparison, or a quorum decision.
An `all` fan-in can be represented today by normal incoming dependencies and a
`barrier` node; transform and barrier nodes default to identity executors in the
native runtimes.

The model-free TypeScript and Python primitive APIs evaluate already-settled
`all`, minimum-count, and exact basis-point percentage policies. They expose
success, failure, missing, and timeout counts and IDs without replacing failures
with null.

**The two schedulers differ here, and the difference matters.**

The ordinary TypeScript scheduler now executes integrated barriers directly. A
barrier node never enters the ready queue; it arms, accumulates a keyed arrival
census, decides at a quiescence point or when its deadline elapses, produces a
`BarrierSatisfied` decision document, and settles. An unsatisfied barrier does
not succeed and does not bind an output under any of its resolutions. The
TypeScript **durable** scheduler still refuses a policy-bearing barrier, because
it does not journal `BarrierSatisfied` yet: an integrated barrier and durable
start/resume cannot be combined today.

The Python scheduler does not execute barriers at all. It carries a complete,
conformance-tested
evaluator in `graph_engineering.integrated_barrier_runtime`, but nothing in the
Python runtime imports it yet, so the scheduler **refuses** a policy-bearing
`barrier` node as the unsupported runtime capability `node-config:barrier`
rather than executing its policy. Refusal is the correct behavior for an
unimplemented gate: a wrong answer is worse than a stop.

Until both lanes execute barriers, a portable graph should either express the
join with ordinary all-dependency edges, or evaluate the settled policy itself
with the primitive API and branch on the result. The portable contract —
quorum, abstention, deadlines, the closed non-pass resolution set, late arrival,
cancellation propagation, and durable zero-rejudge decision replay — is
[integrated barrier semantics](../spec/integrated-barrier-semantics.md),
still a revision-2 candidate that may change.

### Router

A router separates judgment from control flow:

```text
classify risk -> { low: quick review, high: parallel audit, unknown: human }
```

The classification may be model-produced, but route selection should be
deterministic code over a validated enum. The native primitive APIs resolve
strict single/multi route requests, explicit defaults, confidence escalation,
and multicast limits with a shared deterministic corpus. The native schedulers
also execute the pattern package's closed, versioned `RouteEquals` edge
annotation: only selected branches run, unselected branches settle with
`ROUTE_NOT_SELECTED` and zero attempts, and a merge binds only active inputs.
Router results are recomputed from their request evidence and node policy before
they can be committed, including during durable recovery.

This is the first integrated routing slice, not the complete target-v1 router.
The TypeScript runtime adds a zero-rejudge decision layer: a `RouteSelected` or
`BarrierSatisfied` decision carries a policy hash and a decision identity, and a
run seeded with a committed decision adopts it instead of re-evaluating, or
refuses with `DECISION_POLICY_DRIFT` / `DECISION_IDENTITY_MISMATCH`. That layer
is not yet connected to durable history: the durable scheduler does not journal
decision events and does not fold them back on resume, so decisions must be
supplied by the caller. Python has no peer for it at all. Compiler-time
exhaustiveness/default diagnostics and general condition expressions remain open
in both languages.

### Verifier

A verifier tries to disprove or test a candidate before the candidate can cross a
trust boundary. Useful forms include:

- deterministic schema, test, signature, or reproduction checks;
- adversarial refutation by independent reviewers;
- diverse lenses such as correctness, security, performance, and source quality;
- judge panels with explicit pass, reject, and abstain outcomes.

Target v1 keeps maker and verifier contexts separate, preserves every verdict,
and treats insufficient quorum as `unknown`, not success. `validator` exists as a
Graph IR node kind today; panel and gating semantics are not yet implemented.

### Bounded cycle

Cycles are useful for evaluator/optimizer work and discovery of unknown size, but
only when convergence and resource bounds are explicit. The canonical discovery
pattern is “until dry”:

1. find candidates;
2. deduplicate against **everything ever seen**, not only accepted findings;
3. verify fresh candidates;
4. stop after a configured number of dry rounds;
5. also enforce hard iteration, time, attempt, node, and cost limits.

Deduplicating only against accepted findings allows rejected candidates to return
forever. A semantic stop condition without a hard bound can still consume an
unbounded budget.

The alpha compiler rejects implicit graph cycles with `GE1005_CYCLE`. The
TypeScript pattern pack can produce an explicitly finite, acyclic until-dry
blueprint, and the separate native TypeScript/Python bounded controller now
executes `until-dry`, `while`, and evaluator-optimizer policies with durable
seen state, exact reservations, replay/fork, and append-only GraphPatch
revisions. The ordinary DAG scheduler still executes every statically expanded
round and rejects back-edges; integrating dynamic controller revisions into
that scheduler and providing production stores remain follow-up work.

## Failure containment is part of graph shape

A chain has one failure path: if an upstream node fails, every downstream node is
unavailable. A graph can keep independent branches useful. The current native
runtimes record the failure, skip affected descendants with `UPSTREAM_FAILED`,
and continues unrelated ready work.

Containment is not the same as ignoring failure. A fan-in must define whether it
needs all results, a quorum, partial results, or an escalation. Alpha
schedulers support the normal all-dependencies case; standalone settled-barrier
APIs can evaluate minimum and percentage outcomes after collection. Partial
arrival and quorum scheduling are target v1.
See [Failure modes](./FAILURE_MODES.md) for operational consequences.

## Budgets belong to topology

Graph shape controls latency and cost:

- wider fan-out reduces wall time but increases concurrent resource pressure;
- barriers make the critical path wait for the slowest required input;
- standalone pipelines improve flow through bounded buffers and end-to-end
  backpressure;
- retries multiply attempts;
- verification multiplies calls in exchange for confidence;
- cycles and dynamic expansion can grow without a static node count.

Current compilation can enforce graph `maxFanOut` and `maxDepth`; the native
runtimes enforce effective concurrency, node retry counts, timeouts, and
`maxTotalAttempts`, and both expose run cancellation. Standalone pipelines also
enforce `maxItems`, `maxInFlight`, a lowerable `maxStages` budget capped at
2048, per-boundary buffer capacity, per-stage concurrency/retry limits, and a
safe derived maximum-attempt bound. Their inner
attempts are not charged to an enclosing graph's `maxTotalAttempts`. Cost
budgets, dynamic graph-node budgets, provider rate limits, and critical-path
cost estimation remain target-v1 capabilities.

## Durable execution: the semantic boundary

Both native runtimes now expose separate event-sourced start and resume
operations in addition to their existing in-memory scheduler APIs. Start creates
a new run and never silently resumes one. Resume requires an existing run, reads
its original input from `RunCreated`, and never silently creates or replaces it.
Each run binds the compiler graph hash, input hash, effective attempt budget, and
a hash of the caller-supplied implementation identity.

The v1alpha1 durable contract is stricter than periodically serializing memory:

- an append-only run event log is the source of truth;
- every event has a monotonically increasing sequence per run;
- appends use an expected prior version to detect concurrent writers;
- a validated node result is durable before a dependant becomes schedulable;
- resume reuses recorded successful activity results;
- an attempt claim is committed before executor code runs, and a success plus
  its ordered edge emissions is committed before dependants are released;
- a valid terminal resume returns the recorded result with no new event,
  checkpoint write, or executor call.

Recovery correctness currently rebuilds from the complete event stream.
Content-hashed checkpoint adapters exist, but scheduler checkpoint acceleration
is not implemented. Replay, fork, dynamic graph changes, decision-event
journaling, integrated barriers, and distributed lease/fencing are also outside
this slice. CAS rejects stale event appends but is not a distributed lease, so an
application must stop the old coordinator before resuming a run. See the
[durable recovery semantics](../spec/durable-recovery-semantics.md) and
[persistence semantics](../spec/persistence-semantics.md).

### Durable payloads are protected, or the run does not start

A durable run persists authoritative application values, so it requires an
operator-supplied protected payload store and key provider. Without them, start
and resume fail with `PAYLOAD_PROTECTION_REQUIRED` **before** the first event,
checkpoint, log line, error payload, temporary plaintext file, or executor
invocation. There is deliberately no no-op key provider, no in-process default
store, and no fallback to an inline plaintext writer, because each of those turns
a refusal into silent plaintext on disk.

The mechanism is a sink-before-write guard. No runtime sink exposes a public
write method that accepts a raw value; the only way to put a byte into one is a
prepared write minted by the shared guard for that exact sink instance, after a
fixed pipeline: immutable snapshot, portable validation, field/sink
classification, keyed semantic identity, capture policy, redaction or protection,
disposition and schema validation, canary and credential scan, canonicalization.
The guard is total — it returns a suppression, a structured failure, or one
prepared write, never a half-transformed object.

Two honest limits. First, this is not a KMS: key derivation, hardware boundary,
escrow, and rotation schedule belong to the provider, and losing the key means
losing the journal. Second, a recovered value is decoded into process memory so
the scheduler can bind it as node input; protection does not hide a value from an
authorized executor after decryption. What it guarantees is that no byte of that
value reaches a sink outside the protected blob. See
[redaction semantics](../spec/redaction-semantics.md).

### Exactly-once stops at the external boundary

The scheduler can make a committed internal result authoritative for a run. It
cannot atomically commit both its event store and an arbitrary email, payment,
shell command, or third-party API. A crash can occur after the external effect
succeeds but before local success is recorded. External activities are therefore
**at least once**:

- idempotent activities reuse a stable logical-activity key across retries;
- documentation must never promise universal exactly-once effects.

For an open attempt after process loss, durable resume automatically retries only
nodes declared `sideEffects: "none"` or `sideEffects: "idempotent"`, within the
original per-node and global attempt budgets. An idempotent executor receives the
same activity key, but the application must actually forward it to the external
system. An omitted or `"non-idempotent"` declaration fails closed with
`IN_DOUBT_SIDE_EFFECT` and is not invoked again.

The runtime cannot verify that a claimed idempotent operation really is
idempotent. It has no durable activity ledger, reconciliation engine, or approval
callback. Those controls, along with an auditable non-idempotent recovery
protocol, remain application responsibilities and target-v1 work.

## State, artifacts, and isolation

Target v1 separates small structured state from large artifacts. State channels
require an explicit reducer for concurrent writes; artifacts live in a
content-addressed store and edges carry immutable references. This prevents model
contexts and event rows from becoming accidental blob storage.

Parallel file writers also need physical isolation. The target worktree provider
gives each writer a branch/worktree and a merge gate; process/container providers
add isolation for ports, temporary directories, caches, and database schemas.

**No isolation provider exists.** Not a worktree provider, not a
restricted-process provider, not a container provider, not even a no-op one. A
node executor has the ambient authority of the host process that runs it. No
capability policy engine intersects or enforces a manifest, no merge gate runs,
and `approvalRef` is a shape rather than an authenticated decision. Graph IR
`resources` and `isolation` remain opaque declarations; a node that carries one
is refused before dispatch rather than executed under a pretence of containment.
See [`spec/isolation-semantics.md`](../spec/isolation-semantics.md) §0.

The shell adapter is the shape of that honesty in code: it plans and fully
authorizes a launch — argument vector, environment allowlist, byte, duration,
process, and memory caps, no shell expansion — and then refuses to execute it,
because a launch would run with the host process's authority.

Security policy must be separate from graph planning: a planner may request work,
but it cannot grant itself tools, paths, network routes, or secrets. See the
[security architecture](./SECURITY.md).

## Choosing the smallest useful graph

Do not use a graph merely because the framework supports one. A single bounded,
deterministic function should stay a function. A single model call with no tools,
recovery, or independent subwork may stay a call. A graph starts earning its cost
when at least one of these is true:

- work has real independent branches;
- a result must pass a gate before becoming trusted;
- routing changes the downstream work;
- recovery must preserve completed activities;
- shared state needs explicit ownership or reducers;
- the work size is unknown but can converge under hard limits.

Start with contracts and real edges. Add concurrency, verification, persistence,
and isolation only where the failure model requires them.

## Next reading

- [Quickstart](./QUICKSTART.md)
- [Failure modes and mitigations](./FAILURE_MODES.md)
- [Security architecture](./SECURITY.md)
- [Portable Graph IR and diagnostics](../spec/README.md)
- [Runtime semantics](../spec/runtime-semantics.md)
