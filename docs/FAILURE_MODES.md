# Failure modes and mitigations

Graph orchestration does not remove failure. It makes failure domains, retry
boundaries, and recovery decisions explicit enough to test. This document covers
both failures handled by the current alpha and failures the target-v1 design
must handle.

## Status and guarantees

The current TypeScript and Python runtimes are **in-memory DAG schedulers**. Both
native implementations pass the shared diamond and no-layer-barrier ready-queue
conformance cases, bound concurrency/attempts, retry and time out node attempts,
preserve structured failures, skip affected descendants, and let independent
branches continue. Both expose cooperative run cancellation and reject graph
inputs or node results that are not detached portable finite JSON.

Native local event and checkpoint stores now exist, but the schedulers do not yet
write or recover from them. They do not yet provide scheduler-integrated resume,
streaming pipelines, conditional routing, verifier panels, explicit loop
primitives, dynamic graph patches, distributed leases, provider rate limiting,
worktree isolation, or capability enforcement. Sections about those features are
marked **target v1** and are operational requirements, not claims about current
code.

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

**Target-v1 mitigation:** Use an explicit bounded-loop primitive with a semantic
stop condition plus hard iteration, duration, attempt, node, and cost limits. Do
not bypass the compiler with hand-written recursive spawning.

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

The current `sideEffects` field is metadata only; the alpha runtime does not
enforce idempotency or approvals.

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

## Durable execution failures (scheduler integration target v1)

The current scheduler restarts from the beginning after process loss even though
standalone local event/checkpoint adapters are available. The following are
target-v1 recovery requirements.

### Crash after effect, before checkpoint

The external effect may exist while local state says it is incomplete. Reuse a
stable activity idempotency key, record request intent before dispatch where
appropriate, reconcile ambiguous activities, and gate non-idempotent retries.

### Crash after one branch succeeds

Persist each validated node result immediately; do not wait for an entire visual
layer or barrier. Resume must reuse that result and schedule only unfinished work.

### Two orchestrators resume one run

Use a lease plus compare-and-swap event append. A stale owner cannot continue
after losing its lease. Split-brain execution is especially dangerous for side
effects; detecting it after both workers write is too late.

### Code or graph changes during resume

Bind each run to an immutable graph revision/hash and activity implementation
version. Resume the original revision. Replay or fork under changed code must be
an explicit operation with compatibility checks, not an invisible upgrade.

### Checkpoint is mistaken for truth

Treat the append-only event history as the source of truth and checkpoints as
reconstruction accelerators. Validate checkpoint hash/version, and rebuild from
events when it is missing or corrupt.

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
