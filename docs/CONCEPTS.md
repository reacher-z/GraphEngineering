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
| Native runtimes | TypeScript and Python IR, compilers, and in-memory ready-queue schedulers pass the shared diamond and no-layer-barrier runtime conformance cases; APIs remain unstable | Durable/distributed execution and a broader cross-language conformance corpus |
| Topologies | DAG fan-out/fan-in; deterministic settled all/minimum/percentage evaluation; TypeScript constructors for diamonds, verifier fan-out, declarative routing, and finite loop expansion | Streaming pipelines, scheduler-applied routing, verifier policies, quorum/deadline barriers, subgraphs, and dynamic bounded loops |
| Persistence | Native local JSONL event and atomic checkpoint stores implement the shared CAS/hash contract; schedulers remain in-memory and are not wired to recovery | Scheduler-integrated resume, replay, fork, leases, artifact stores, and production databases |
| Security | Graph bounds and explicit side-effect metadata; executors still have the ambient authority of their process | Enforced capabilities, worktree/process/container isolation, redaction, approval gates, and policy-audited dynamic graphs |

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

Graph IR reserves `edge.mode: "stream"`, but the current runtime does **not**
implement streaming, bounded buffers, or backpressure. Those are target-v1
features. Until then, describing an edge as `stream` does not make execution a
pipeline.

### Barrier

A barrier is justified when a decision needs multiple upstream outcomes together:
cross-source deduplication, ranking, a complete comparison, or a quorum decision.
An `all` fan-in can be represented today by normal incoming dependencies and a
`barrier` node; transform and barrier nodes default to identity executors in the
native runtimes.

The model-free TypeScript and Python primitive APIs now evaluate already-settled
`all`, minimum-count, and exact basis-point percentage policies. They expose
success, failure, missing, and timeout counts and IDs without replacing failures
with null. This is not yet a scheduler barrier: waiting for partial arrivals,
durable barrier state, deadlines, quorum voting, and cancellation remain target
v1 runtime work.

### Router

A router separates judgment from control flow:

```text
classify risk -> { low: quick review, high: parallel audit, unknown: human }
```

The classification may be model-produced, but route selection should be
deterministic code over a validated enum. Target v1 requires exhaustive routes or
an explicit fallback, records the chosen edge, and reuses the recorded decision
during replay. The native primitive APIs now resolve strict single/multi route
requests, explicit defaults, confidence escalation, and multicast limits with a
shared deterministic corpus. They do not execute an edge: although `router` is a
node kind in Graph IR, conditional edge execution and replayed `RouteSelected`
events are not implemented by the current runtime.

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
blueprint, but the current scheduler executes every expanded round and does not
short-circuit on a dry verdict. Runtime bounded-loop control and dynamic graph
patches remain target-v1 work; ordinary back-edges are not accepted as a
substitute.

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
- pipelines improve flow but require bounded buffers and backpressure;
- retries multiply attempts;
- verification multiplies calls in exchange for confidence;
- cycles and dynamic expansion can grow without a static node count.

Current compilation can enforce graph `maxFanOut` and `maxDepth`; the native
runtimes enforce effective concurrency, node retry counts, timeouts, and
`maxTotalAttempts`, and both expose run cancellation. Cost budgets, dynamic node
budgets, provider rate limits, and
critical-path cost estimation remain target-v1 capabilities.

## Durable execution: the semantic boundary

The current TypeScript and Python schedulers are in-memory. A process crash loses
their run progress, and rerunning starts a new execution. Separate native local
persistence packages now provide last-sequence-CAS event streams and atomic,
content-hashed checkpoints, but the schedulers do not yet emit those events or
resume from those checkpoints. Storage primitives are not recovery by
themselves.

The target-v1 durable contract is stricter than periodically serializing memory:

- an append-only run event log is the source of truth;
- every event has a monotonically increasing sequence per run;
- appends use an expected prior version to detect concurrent writers;
- a validated node result is durable before a dependant becomes schedulable;
- checkpoints accelerate reconstruction but do not replace event history;
- resume reuses recorded successful activity results;
- replay uses recorded nondeterministic results instead of calling the outside
  world again;
- fork creates a new linked history rather than rewriting the old one.

The first three storage-level rules are executable in both languages and pass a
shared checkpoint hash vector. The remaining scheduler-level rules define what
recovery must mean before resume can be claimed. See the
[persistence semantics](../spec/persistence-semantics.md); the existence of a
store is not evidence that the alpha scheduler already persists progress.

### Exactly-once stops at the external boundary

The system can make an internal checkpointed result effectively once. It cannot
atomically commit both its store and an arbitrary email, payment, shell command,
or third-party API. A crash can occur after the external effect succeeds but
before local success is recorded.

Therefore target-v1 external activities are **at least once**:

- idempotent activities reuse a stable logical-activity key across retries;
- an activity ledger records request and result evidence;
- non-idempotent recovery requires explicit policy or human confirmation;
- documentation must never promise universal exactly-once effects.

Node `sideEffects` metadata exists in Graph IR, but the alpha executor does
not yet enforce idempotency or approval. Treat every custom executor according to
the actual external system it calls.

## State, artifacts, and isolation

Target v1 separates small structured state from large artifacts. State channels
require an explicit reducer for concurrent writes; artifacts live in a
content-addressed store and edges carry immutable references. This prevents model
contexts and event rows from becoming accidental blob storage.

Parallel file writers also need physical isolation. The target worktree provider
gives each writer a branch/worktree and a merge gate; process/container providers
add isolation for ports, temporary directories, caches, and database schemas.
These providers are not implemented in the current runtime. Custom executors run
in the same process unless the application isolates them itself.

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
