# Bounded cycle and dynamic graph-patch semantics v1alpha1

Status: normative D7 protocol freeze; native implementation unavailable. This
contract and its machine-readable schemas close the former controller-carrier
and durable-controller contract gaps. They do not claim that the current
schedulers execute cycles or patches. Native TypeScript/Python controllers and
their executable cross-language conformance join remain release-blocking as
described in section 15.

This document defines the only legal way to repeat or dynamically extend work
in Graph Engineering. Ordinary `GraphSpec.edges` remain acyclic. A runtime MUST
NOT infer a loop from a back-edge, a prompt, an edge condition, or a planner's
free text.

The core safety rule is:

> Every cycle has a deterministic convergence rule and independent hard limits.
> Every patch is an append-only, compare-and-swap transition to a validated
> graph revision.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative.

## 1. Scope and non-goals

This revision specifies:

- `until-dry`, bounded `while`, and evaluator-optimizer controllers;
- a global seen set whose contents survive rejected findings and resume;
- hard iteration, duration, cost, attempt, discovery, and dynamic-node limits;
- stable round records, exit reasons, and replay behavior;
- the `GraphPatch` wire document and append-only application rules;
- validation, authorization, budget, and compare-and-swap gates; and
- dry-run behavior and cross-language observations.

This revision does not grant tools, filesystem, network, model, or secret
authority. It does not make an external side effect exactly-once. It does not
define a distributed lease implementation, a semantic-similarity service, or a
model-powered convergence oracle. Those are explicit adapters or later
contracts.

## 2. Portable JSON and ordering

All controller policies, candidates, verdicts, patch documents, records, and
results cross the same portable JSON boundary as Graph IR. They MUST reject
non-finite numbers, unsafe integers, host objects, aliases, cycles, accessors,
non-string object keys, and other language-only values before execution.

Validation itself is resource bounded. Before recursive inspection, a transport
MUST enforce its configured raw-frame limit. Programmatic values MUST be walked
with a maximum constructed depth of 100 and at most 100,000 total scalar or
collection values. A `GraphPatch` additionally has a hard canonical UTF-8 limit
of 4,194,304 bytes. Implementations MAY configure lower deployment limits, but
they MUST NOT accept a value beyond these protocol ceilings. Limit failure does
not invoke a getter, proxy trap, planner, finder, evaluator, compiler plugin, or
other caller code.

Declaration order is observable and MUST be preserved for:

1. candidates returned within a round;
2. appended nodes and edges;
3. ordered diagnostic issues.

Object-key order, including `append.outputs`, is not semantic. Output names and
other map keys are validated and diagnosed in Unicode code-point order. Hashing
uses the canonical JSON profile defined by the Graph IR specification.

## 3. Controller policy

A controller owns one closed policy. Unknown fields are invalid.

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/cycle-policies/v1alpha1",
  "kind": "CycleControllerPolicy",
  "mode": "until-dry",
  "maxIterations": 20,
  "maxDurationMs": 300000,
  "maxCostUsd": 5,
  "maxTotalAttempts": 200,
  "maxDiscoveries": 10000,
  "maxDynamicNodes": 500,
  "maxCandidatesPerRound": 500,
  "maxCandidateBytes": 65536,
  "maxCandidateBatchBytes": 4194304,
  "consecutiveDryRounds": 2
}
```

`kind` is exactly `CycleControllerPolicy`. `mode` is exactly `until-dry`,
`while`, or `evaluator-optimizer`. The normative machine contract is
[cycle-controller-policy.schema.json](cycle-controller-policy.schema.json).

Every canonical policy MUST own `maxIterations`, a safe integer from 1 through
10,000. There is no implicit default and no unbounded sentinel. All bounds in
the table are required in the canonical document. A caller-facing convenience
layer MAY inherit a tighter graph/run/tenant/provider bound, but it MUST resolve
the minimum into this closed effective policy before hashing, persistence, or
the standalone API call. Missing effective limits are invalid rather than
implicit infinity:

| Field | Range | Accounted quantity |
| --- | --- | --- |
| `maxDurationMs` | integer 1..2,147,483,647 | recorded orchestration duration |
| `maxCostUsd` | finite number >= 0 | committed plus reserved activity cost |
| `maxTotalAttempts` | safe integer >= 1 | node/model/tool attempts, including failures |
| `maxDiscoveries` | integer 0..10,000,000 | distinct keys first inserted into `seen` |
| `maxDynamicNodes` | integer 0..100,000 | nodes appended by accepted patches |
| `maxCandidatesPerRound` | integer 1..100,000 | total returned candidates, including duplicates |
| `maxCandidateBytes` | integer 1..1,048,576 | canonical UTF-8 bytes in one candidate |
| `maxCandidateBatchBytes` | integer 1..16,777,216 | canonical UTF-8 bytes in the complete candidate array |

`until-dry` additionally MUST own `consecutiveDryRounds`, an integer from 1
through 100. The other two kinds MUST NOT contain that field.

`while` consumes a deterministic boolean condition after candidate evaluation
and before each round commit. `evaluator-optimizer` consumes a structured
verdict of `accept`, `revise`, or `unknown` at the same phase. Conditions and
verdicts are recorded activities when they depend on a model, tool, clock,
random source, or external system.

`maxCandidatesPerRound`, `maxCandidateBytes`, and
`maxCandidateBatchBytes` are always required; none has an implicit default.
The independent batch-byte limit prevents the product of a legal item size and
legal item count from becoming an unbounded allocation. All three limits count
duplicates, including candidates whose keys are already in `seen`.

Normalization is rejected before a canonical request exists when no effective
duration, cost, attempt, discovery, or dynamic-node bound can be established
for an operation that can consume that resource. `maxIterations` alone bounds
rounds, but MUST NOT be misrepresented as a cost, attempt, or dynamic-node
bound.

When patches are enabled, an effective complete-graph node, edge, output,
topological-depth, and per-node fan-out limit MUST also exist. Independent of a
tighter graph/run/tenant policy, a patch candidate may contain at most 100,000
nodes, 200,000 edges, and 100,000 named outputs in the complete resulting graph.
Per-patch schema limits do not replace these cumulative limits. A controller
round may propose at most one patch; emitting several documents is invalid
rather than an implicit multi-patch transaction.

### 3.1 Standalone integration carrier

The v1alpha1 carrier is the separately versioned standalone request in
[cycle-controller.schema.json](cycle-controller.schema.json). It is not a
`GraphSpec` node. `graph.schema.json` remains unchanged and has no hidden
controller kind. Free-form node config, metadata labels, prompts, edge
conditions, and `LoopContinue` annotations are never legal dynamic-cycle
carriers.

The request binds one `controllerRunId` and `controllerId` to a host graph run
using `hostRun.relationship == "standalone-child-controller"`. It owns a
separate `eventStreamId` and `checkpointScope`; controller events MUST NOT be
inserted into `scheduler-recovery/v1alpha1` and ordinary scheduler events MUST
NOT be interpreted as controller facts. The request also contains:

- the fully resolved policy;
- the exact authoritative objective payload and its hash;
- versioned key-strategy and rubric identities;
- authority-ceiling, pricing-policy, and implementation hashes;
- the exact initial graph revision triple;
- closed finder, candidate-evaluator, condition, optimizer-evaluator, and
  patch-planner activity bindings, with inapplicable bindings explicitly
  `null`;
- patch enablement and complete resulting-graph limits; and
- explicit start/fork lineage.

The request's `payloadProfile` is the truthful inline-alpha boundary from
section 13.6. It cannot claim protection or redaction.

The standalone public operations are logically distinct:

1. `start(request, leaseClaim)` requires an empty controller stream;
2. `resume(exactRequest, expectedVersion, leaseClaim)` requires the same
   `requestHash` and `controllerHash` and an existing nonterminal stream;
3. `replay(controllerRunId, throughSequence?)` is read-only and consumes only a
   valid stored prefix; and
4. `fork(newRequest, parentControllerRunId, parentSequence,
   parentHistoryHash)` creates a new stream whose request lineage binds the
   exact source prefix.

Start never resumes, resume never starts, replay never dispatches, and fork
never mutates the parent.

`controllerHash` is the domain-separated hash in section 13. `requestHash` is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-controller-request/v1alpha1\0") ||
  UTF8(canonical(complete-controller-request))
)
```

The request does not contain either hash, avoiding a self-referential preimage.
`ControllerCreated` stores the exact request, identity body, and both computed
hashes. The canonical result carrier is
[cycle-controller-result.schema.json](cycle-controller-result.schema.json).

## 4. Candidate and seen-set contract

Discovery output is an ordered array of closed candidate objects:

```json
{
  "key": "sha256:9a7f...",
  "value": {"file":"src/auth.ts","line":42,"finding":"missing guard"}
}
```

`key` is a non-empty Unicode-scalar string whose UTF-8 encoding is at most 512
bytes. Lone UTF-16 surrogate code units are invalid for a key even though the
general portable JSON encoder can escape them in an unrelated value. Keys
compare byte for byte after JSON decoding. Runtimes MUST NOT case-fold, trim,
Unicode-normalize, or reinterpret them. Applications SHOULD use a versioned
domain key or the lowercase SHA-256 of canonical candidate identity. Candidate
`value` is portable JSON and may be `null`. Candidate objects are closed:
fields other than `key` and `value` are invalid.

The controller owns one `seen` set for the entire logical cycle history. At the
start of each round it processes candidates in declaration order:

1. a key already in `seen` is a duplicate and is not fresh;
2. otherwise the key is inserted into `seen` immediately and is fresh; and
3. duplicate keys later in the same batch observe the insertion and are not
   fresh.

Insertion happens before verification, ranking, rejection, abstention, a patch
proposal, or downstream failure. Rejected and unknown candidates remain seen.
A runtime MUST NOT deduplicate only against confirmed results, because that can
rediscover a rejected candidate forever.

"Immediately" is a logical ordering rule, not permission for a mutable
in-memory insertion that can be lost in a crash. The runtime first validates the
complete batch, its canonical sizes, and the number of would-be-fresh keys
against the remaining discovery reservation using a detached temporary view. It
then durably commits one discovery fact containing the exact batch (or a
content-addressed lossless artifact), its hash, and the ordered `seen`
additions. Only that atomic commit changes the authoritative set. A crash before
the commit adds nothing; a crash, evaluation failure, patch rejection, or
cancellation after it does not remove the additions. Resume folds these
discovery facts before doing any further work and never reruns their finder.

A dry round is exactly a fully committed round whose durable discovery fact had
zero fresh candidates.
Verifier rejection does not make a non-dry round dry. An execution failure,
cancellation, invalid output, or uncommitted round is not a dry round.

Before discovery, the controller passes the finder the remaining discovery
credit and the effective per-round count, item-byte, and batch-byte limits.
Returned output exceeding any reserved limit is invalid and the round fails
without a partial discovery commit or partial insertion.
When `seenCount` equals the effective `maxDiscoveries`, a mode that requires another discovery
exits `MAX_DISCOVERIES` before dispatch. This prevents one speculative batch
and avoids a partially recorded seen set.

Verdicts are an ordered, closed array keyed only by fresh candidates. Every
fresh key occurs exactly once and receives exactly one of `accept`, `reject`, or
`unknown`; a duplicate or previously seen key MUST NOT receive a new verdict.
A missing, extra, or repeated verdict makes evaluation invalid. Duplicate
candidate values remain in the durable batch for audit/replay, but only the
first occurrence supplies the fresh value evaluated in that logical history.

## 5. Round state machine

Iterations are one-based positive safe integers. A durable reservation assigns
an iteration exactly once; it is never reused after failure or process loss.
The state transition is:

```text
ready -> reserved -> running -> discovered -> evaluated -> committed
          |           |             |             |
          +-----------+-------------+-----------> failed
          +-----------+-------------+-----------> cancelled
```

Before dispatch, the controller MUST derive a closed round plan and atomically
reserve the maximum attempts, priced usage, and structural capacity that plan
can consume. The plan includes finder, verifier, condition/evaluator, and at
most one patch path. Candidate-dependent fan-out is reserved at its configured
worst case; a planner promise to "probably use less" is not a bound. Priced
activities require a versioned price and usage ceiling. If no sound upper bound
exists, configuration or dispatch fails closed.

`RoundReserved` stores that complete plan, not only an opaque digest. The
closed machine projection is `roundPlan` in
[cycle-controller-event.schema.json](cycle-controller-event.schema.json):
finder and candidate-evaluator reservations are required; the mode activity is
exactly the condition, optimizer evaluator, or `null` selected by the policy;
the patch planner is either one request-bound reservation or `null`; and
`maxDynamicNodes` is the per-round structural ceiling supplied to that planner.
Each activity reservation binds its phase, request activity ID, positive
attempt ceiling, and exact worst-case binary64 cost. The latter is obtained by
adding the request's per-attempt ceiling once per reserved attempt in phase
order. A round may choose a tighter ceiling than the request, but it MUST
enforce the recorded ceiling and cannot widen it after seeing candidates.

The sibling `maximum` MUST equal the sum of the stored activity reservations
and `maxDynamicNodes`, and all of it MUST fit the remaining controller policy.
`planHash` is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-round-plan/v1alpha1\0") ||
  UTF8(canonical(round-plan))
)
```

The exact plan is retained in the checkpoint's open-round projection. Recovery
therefore rejects a valid-looking reservation smaller than the work the
controller had authorized.

Capacity fits only when `committed + all live reservations + requested <=
effectiveLimit`. Work that cannot fit is not dispatched. Starting an attempt
consumes its attempt claim. Recorded provider usage commits cost; in-doubt
external usage remains charged. Accepted patch elements commit structural
capacity. Unused reservation is explicitly released after the corresponding
phase becomes impossible. A reservation and every release/commit are durable,
CAS-ordered facts; none can disappear on retry, cancellation, store failure, or
process loss. Integer counters use safe checked arithmetic. Cost uses finite
binary64 additions in durable event order and fails closed at the boundary; no
epsilon comparison or language-native decimal reordering is permitted.

A release is never an untyped subtraction. `phase-complete` carries the exact
completed `phase` and releases exactly that phase plan's unused
attempt/cost/structure credit once. Every other reason omits `phase` and closes
the round reservation by releasing its entire exact remainder:
`round-complete` requires all selected phases to have produced their facts,
`failed` requires an unresolved activity-failure fact, `patch-rejected` requires the
stored rejected decision, `cancelled` is closed by the terminal cancellation
observation, and `bound-reached` is closed by at least one folded resource or
deadline observation. No activity may be dispatched after a closing release,
and a zero-unit release is invalid. These bindings prevent a syntactically
balanced release from laundering capacity that is still reachable by the
recorded round plan.

Duration is enforced by a trusted, recorded cycle-start time and absolute
deadline, not by a reservation that pretends to stop a non-cooperative call.
Every dispatched activity receives a timeout no later than the remaining
deadline. Once the deadline is observed, no new work or result-dependent patch
is released. Late external effects remain governed by the at-least-once and
in-doubt rules.

Live runtimes record integer elapsed milliseconds from a trusted clock adapter.
Values are nondecreasing; resume uses at least the last recorded elapsed value
and compares the current trusted time with the stored absolute deadline. A
clock value that cannot be represented safely, a deadline arithmetic overflow,
or an unexplained rollback that prevents safe enforcement fails closed instead
of granting more time. Replay reads the recorded elapsed values and terminal
reason without consulting a clock.

One committed round record has this closed observable projection:

```json
{
  "iteration": 3,
  "candidateBatchHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "candidateCount": 4,
  "freshKeys": ["a", "b"],
  "duplicateKeys": ["a", "c"],
  "acceptedKeys": ["a"],
  "rejectedKeys": ["b"],
  "unknownKeys": [],
  "modeOutcome": {"mode":"until-dry"},
  "patchDecision": null,
  "consecutiveDryRounds": 0,
  "attemptsUsed": 12,
  "costUsd": 0.42,
  "dynamicNodes": 6,
  "durationMs": 1820
}
```

`modeOutcome` is exactly one of `{"mode":"until-dry"}`,
`{"mode":"while","condition":<boolean>}`, or
`{"mode":"evaluator-optimizer","verdict":"accept|revise|unknown"}`.
`patchDecision` is `null` or the closed recorded patch decision defined below.
The counters are cumulative totals after the round, not deltas.

Key arrays preserve occurrence order. `freshKeys` contains each first-seen key
once. `duplicateKeys` contains one entry for every duplicate occurrence, so the
same key may appear more than once. A fresh key MUST appear in exactly one of
`acceptedKeys`, `rejectedKeys`, or `unknownKeys` once evaluation is complete. A
controller MAY pause at an explicit human gate, but it cannot commit the round
while that gate is unresolved. Choosing not to open a gate records `unknown`
and permits the round to commit immediately before the non-success terminal
decision.

The event/history representation MAY contain additional versioned envelope
metadata, but its portable projection and counters MUST agree byte-for-byte with
this record. A completed round is durably committed before convergence is
selected or the next iteration starts. A discovered but incomplete round keeps
its durable seen additions, consumes its assigned iteration, and is never
treated as dry.

The terminal result's `iterations` is the number of durable round reservations,
including a last round that later failed or was cancelled. Reservations are
contiguous, only one round may be open, and resume continues that same round
from its last committed phase rather than allocating a new iteration.

## 6. Convergence rules

### 6.1 Until dry

The counter starts at zero. A committed dry round increments it; a committed
round containing at least one fresh key resets it to zero. Equality produces the
`DRY` convergence candidate immediately after commit, subject to the hard-stop
precedence in section 7.

### 6.2 Bounded while

The first round runs without an implicit precondition. After discovery and
candidate evaluation, the condition is evaluated and durably recorded before
the round commit. `false` produces `CONDITION_FALSE` subject to section 7;
`true` permits another
round only if all hard-limit preflight checks pass. A crash after the condition
record cannot reevaluate it. Callers that need a precondition MUST evaluate it
before starting the cycle.

### 6.3 Evaluator optimizer

After discovery and candidate evaluation, the evaluator returns one closed
verdict which is durably recorded before the round commit:

- `accept` produces `EVALUATOR_ACCEPTED`, subject to section 7;
- `revise` permits another round, subject to every hard limit; or
- `unknown` produces `UNKNOWN_VERDICT` or opens an explicitly configured
  human gate. It MUST NOT become an implicit accept.

Maker and evaluator contexts are isolated. The evaluator receives the original
objective, candidate output, rubric identity, and required evidence, not an
unverifiable summary alone.

## 7. Hard-stop evaluation and exit reasons

Limits are checked before the first round, before each dispatch, after each
recorded activity update, before applying a patch, and before starting the next
round. No check authorizes one extra iteration or speculative source read.

A resource reason is observable when a required reservation does not fit, when
positive newly committed usage reaches or exceeds its exact limit, or when measured time
reaches the deadline. Merely configuring a zero cost or zero dynamic-node limit
does not stop a zero-cost, patch-free deterministic round; a positive operation
must be required. Discovery is different by design: another finder can produce
a new key, so zero remaining discovery credit stops it before dispatch.
`maxIterations` is consumed by the durable round reservation. Consequently a
convergence condition reached on the last allowed iteration is simultaneous
with `MAX_ITERATIONS`, and the precedence below intentionally reports the hard
bound. Comparisons are exact and inclusive; there is no one-extra-operation
grace interval.

When multiple reasons are observable at the same committed boundary, the
portable precedence is:

1. `CANCELLED`
2. `MAX_DURATION`
3. `MAX_COST`
4. `MAX_TOTAL_ATTEMPTS`
5. `MAX_DYNAMIC_NODES`
6. `MAX_DISCOVERIES`
7. `MAX_ITERATIONS`
8. `PATCH_REJECTED`
9. `FAILED`
10. `UNKNOWN_VERDICT`
11. successful mode-specific convergence

`ControllerTerminated` stores one closed `exitObservation` beside the result.
It records every boolean in this precedence list, a structured `failureCode`
when and only when `failed` is true, and the mode-specific convergence reason
or `null`. Replay recomputes hard-limit, patch, unknown, and convergence facts
from the prefix and requires the result's `exitReason` to be the first true
observation above. Cancellation and a controller-level structured failure are
facts of the terminal event itself; they cannot be silently omitted to select a
lower-precedence reason. Mode-specific result-schema constraints additionally
forbid, for example, `DRY` on `while` or `CONDITION_FALSE` on `until-dry`.

The stable exit-reason set is:

```text
DRY
CONDITION_FALSE
EVALUATOR_ACCEPTED
UNKNOWN_VERDICT
MAX_ITERATIONS
MAX_DURATION
MAX_COST
MAX_TOTAL_ATTEMPTS
MAX_DYNAMIC_NODES
MAX_DISCOVERIES
PATCH_REJECTED
FAILED
CANCELLED
```

`DRY`, `CONDITION_FALSE`, and `EVALUATOR_ACCEPTED` are successful convergence.
`UNKNOWN_VERDICT` is non-success unless a human approval resolves it.
Hard-limit exits are safe bounded termination, but they are not semantic
success. `PATCH_REJECTED`, `FAILED`, and `CANCELLED` are non-success.

The exact result carrier is validated by
[cycle-controller-result.schema.json](cycle-controller-result.schema.json):

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/cycle-results/v1alpha1",
  "kind": "CycleControllerResult",
  "controllerRunId": "cycle-run-7",
  "controllerHash": "1111111111111111111111111111111111111111111111111111111111111111",
  "requestHash": "2222222222222222222222222222222222222222222222222222222222222222",
  "mode": "until-dry",
  "status": "bounded",
  "exitReason": "MAX_ITERATIONS",
  "iterations": 20,
  "consecutiveDryRounds": 0,
  "seenCount": 184,
  "acceptedCount": 31,
  "rejectedCount": 148,
  "unknownCount": 5,
  "unevaluatedCount": 0,
  "attemptsUsed": 197,
  "costUsd": 4.81,
  "dynamicNodes": 92,
  "durationMs": 294002,
  "lastGraphRevision": 7,
  "lastGraphHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "lastRevisionHash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "terminalSequence": 220,
  "historyPrefixHash": "3333333333333333333333333333333333333333333333333333333333333333"
}
```

`status` is derived, never caller supplied: successful convergence reasons map
to `converged`; every `MAX_*` reason maps to `bounded`; `UNKNOWN_VERDICT` maps
to `unknown`; `PATCH_REJECTED` and `FAILED` map to `failed`; and `CANCELLED`
maps to `cancelled`. Counters are monotonic and MUST reconcile with committed
records and reservation facts. The last revision triple MUST equal the folded
current revision even when no patch was accepted. A key durably discovered but
not categorized because the controller failed or was cancelled is counted in
`unevaluatedCount`; it is not fabricated as `unknown`. At every terminal result,
`seenCount == acceptedCount + rejectedCount + unknownCount +
unevaluatedCount`, so no discovered key can disappear between categories.
`consecutiveDryRounds` is the folded counter for `until-dry` and is exactly zero
for the other controller modes. `terminalSequence` is the sequence of the
enclosing `ControllerTerminated` event. `historyPrefixHash` is that event's
`previousEventHash`; the terminal event's own `recordHash` cannot appear inside
its preimage. The envelope and event together therefore bind both the complete
result and its exact history position without a self-referential hash.

## 8. GraphPatch wire document

The normative schema is [graph-patch.schema.json](graph-patch.schema.json). A
patch has the following closed form:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/patches/v1alpha1",
  "kind": "GraphPatch",
  "patchId": "discover-round-3",
  "base": {
    "graphRevision": 2,
    "graphHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "revisionHash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  },
  "append": {
    "nodes": [],
    "edges": [],
    "outputs": {
      "report": {"node":"synthesize","port":"report"}
    }
  }
}
```

`patchId` is unique within one run. `base` binds the exact current graph
revision using all three coordinates. `append` MUST add at least one node,
edge, or output. Node and edge arrays preserve declaration order; output names
are an unordered map and are processed in Unicode code-point order.

The patch document has no delete, replace, move, copy, rename, policy-change,
schema-change, entrypoint-change, or metadata-change operation. Unknown
operations and fields are invalid. Dry-run is an invocation option, not a field
in the hashable patch document.

`patchHash` is the lowercase SHA-256 of the patch's canonical JSON bytes. It is
not caller supplied. A dry-run does not consume a `patchId`. Once a non-dry-run
decision is durably recorded, reusing its `patchId` with different canonical
bytes is an idempotency conflict. Reusing the exact decided document returns
the recorded acceptance or rejection even if its base is now stale. The runtime
therefore performs the decided-ID lookup before the current-base comparison and
also repeats it after a lost CAS race. Schema-invalid or uninspectable input is
not a durable patch decision and does not reserve an ID.

A portable patch decision is closed and contains `patchId`, `patchHash`,
`outcome` (`accepted` or `rejected`), the requested base triple, ordered
diagnostics, the authority/policy snapshot hashes, and the complete budget
reservation outcome. An acceptance additionally contains the resulting revision
triple; a rejection MUST NOT invent one. The protected durable history retains
the exact detached patch bytes (directly or through a lossless artifact) so hash
collision or caller mutation cannot turn different bytes into an idempotent
retry. User-facing logs apply the redaction contract and never expose raw node
configuration merely because the event store needs recovery data.

Inside a controller round, no proposal is represented by `patchDecision: null`.
An accepted proposal records `accepted`; any rejected required proposal records
`rejected` and terminates the controller with `PATCH_REJECTED` after higher
precedence cancellation/resource reasons are checked. The controller cannot
silently discard the rejection and ask a model for different bytes in the same
iteration.

Starting the patch-planner activity means it MUST return exactly one patch or a
structured `ActivityFailed`; a successful "no patch" activity result does not
exist in this version. A deterministic decision not to invoke the planner is
represented by no `ActivityStarted` and `patchDecision: null`, followed by
release of its unused round reservation. This prevents an invoked planner from
becoming an unclosed in-doubt activity merely because it returned no document.

## 9. Patch application transaction

Patch application is one fail-closed transition:

1. snapshot and validate portable input without executing caller code;
2. validate `graph-patch.schema.json`;
3. compute `patchHash`;
4. return or reject an already decided `patchId` as described above;
5. reject cancellation, a terminal run, and a non-current base triple;
6. reject duplicate node IDs, edge IDs, and output names against the base and
   within the patch;
7. append nodes and edges in declaration order, then output names in Unicode
   code-point order, to a detached candidate graph;
8. run the complete Graph IR compiler and schema/typed-port checks;
9. enforce folded node/run state plus graph, run, controller, tenant,
   capability, approval, redaction, and isolation policy against an
   authenticated authority snapshot;
10. prove the remaining deadline and reserve dynamic structure, fan-out, depth,
    attempt, and cost capacity;
11. derive the candidate graph hash and next revision triple;
12. append one durable accepted decision using expected-event-sequence CAS; and
13. only after that append succeeds, replace the in-memory current graph and
    expose new schedulable work.

Any failure leaves the base graph and scheduler unchanged. A schema-valid
non-dry proposal that reaches a semantic decision records one rejected decision
when the run store remains writable. A runtime MUST NOT partially append nodes,
expose a new edge before its node exists, or decrement a budget without a
corresponding auditable reservation outcome. The authoritative current revision
is folded from the accepted decision event; there is no second mutable revision
record whose commit can split from the event append. Tenant-wide reservations
held in another CAS ledger require a durable release/commit outcome if the run
CAS loses.

Cancellation observed before the acceptance CAS prevents it. Cancellation
observed after a successful acceptance cannot roll the revision back; it wins
the controller exit precedence, stops scheduling newly exposed work, and the
accepted revision remains part of history.

The new revision number is exactly `base.graphRevision + 1`; a base already at
the maximum safe integer is unsupported. Revision numbers are monotonic per run
and cannot be reused. The candidate graph hash is the canonical hash of the
complete resulting `GraphSpec`.

The machine-readable later-revision record is
[graph-revision.schema.json](graph-revision.schema.json). Its root contains the
closed `body` below and a sibling `revisionHash`. The root schema accepts only
revision 2 through the maximum safe integer; revision 1 remains exclusively the
initial `CompiledGraphIdentity` seed.

Revision 1 is seeded by the `revisionHash` from the existing initial
`CompiledGraphIdentity`. That schema intentionally has `graphRevision: 1` and
MUST NOT be used to represent revision 2 or later. A later coordinate uses this
exact body:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1",
  "kind": "GraphRevision",
  "graphRevision": 3,
  "previousRevisionHash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "patchHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "graphHash": "1111111111111111111111111111111111111111111111111111111111111111"
}
```

Its `revisionHash` is:

```text
SHA-256(
  UTF8("graph-engineering/revision-chain/v1alpha1\0") ||
  UTF8(canonical(revision-body))
)
```

The body is returned beside, not with, `revisionHash`; the hash field is never
included in its own preimage. `previousRevisionHash` is exactly the base
revision hash. This domain and preimage are the only v1alpha1 revision-chain
algorithm, so TypeScript and Python cannot choose host-specific lineage JSON.

## 10. Patch safety and authority

A patch MUST be rejected when it:

- targets a stale or unknown base revision;
- mutates or shadows any existing identity;
- introduces an ordinary cycle or an unreachable node;
- targets any pre-existing node with a new incoming edge, regardless of that
  node's pending, scheduled, running, or terminal state;
- originates an edge at a pre-existing node whose success and durable output
  have not already committed;
- weakens graph/run policy or exceeds any effective hard limit;
- grants a tool, filesystem, network, secret, model, or isolation capability
  unavailable to the proposing node and run;
- bypasses typed ports, schema compatibility, routing exhaustiveness, reducer,
  approval, redaction, or isolation checks;
- exceeds the effective dynamic fan-out, depth, node, attempt, cost, or duration
  reservation; or
- relies on unsupported stream, artifact, provider, or side-effect semantics.

Planners can choose work only inside existing authority. They cannot make a
patch safe by describing a broader permission in natural language. Authority is
not a caller-controlled field in the hashable patch. The application invocation
carries a runtime-derived principal or proposing-node attempt, its immutable
grant hash, the run grant, and policy versions. The recorded effective grant is
the intersection of proposer, run, tenant, and deployment grants. An appended
node can delegate only that intersection or a subset; later patches from that
node cannot recover authority discarded by an earlier intersection.

An appended edge may originate at an existing succeeded node because its
durable output can be replayed into new work. It may target only an unscheduled
new node declared in the same patch. Edges between new nodes in the same patch
are allowed if the complete graph remains acyclic and reachable. An appended
output name may reference an existing or new node, but it cannot replace an
existing graph output and must remain compatible with the unchanged graph
`outputSchema`. A patch is never accepted after a terminal run event. A paused
run may accept one only under explicit mutation authority, and no new node is
scheduled until the run resumes.

Appending uses safe data-property operations or null-prototype maps. Output
names such as `__proto__` are data, never prototype setters; an implementation
that cannot preserve that distinction MUST reject the patch rather than invoke
host behavior.

## 11. Dry run

`dryRun: true` executes steps 1 through 11 of the patch transition against a
detached snapshot and returns the same ordered diagnostics, authority/policy
snapshot hashes, simulated reservation delta, candidate graph hash, revision
body, and revision hash that a real application would produce at that exact
snapshot. Step 10 is simulation only. Dry-run performs no compare-and-swap,
durable append, patch-ID reservation, scheduler mutation, external activity, or
budget consumption. It cannot mutate an in-memory cache that later bypasses a
real gate.

A dry-run result is advisory. A later real application MUST repeat every gate;
it cannot trust the previous result because the base revision, policy, budget,
authority, pricing version, or run state may have changed. A dry-run cannot
promise that the later CAS will win.

## 12. Diagnostics

Cycle and patch validation errors use a stable code plus ordered issues with
JSON Pointer paths. The initial code set is:

| Code | Meaning |
| --- | --- |
| `GE_CYCLE_INVALID_POLICY` | closed policy shape or numeric bound is invalid |
| `GE_CYCLE_INVALID_CANDIDATE` | candidate key/value violates the wire contract |
| `GE_CYCLE_COUNTER_MISMATCH` | history counters do not reconcile |
| `GE_CYCLE_INVALID_HISTORY` | round order, exit, or transition is impossible |
| `GE_PATCH_INVALID` | patch schema or portable JSON is invalid |
| `GE_PATCH_STALE_BASE` | base hash/revision/revision-hash CAS does not match |
| `GE_PATCH_IDEMPOTENCY_CONFLICT` | a decided `patchId` is reused with different canonical bytes |
| `GE_PATCH_DUPLICATE_ID` | an appended node, edge, or output identity collides or repeats |
| `GE_PATCH_GRAPH_INVALID` | resulting Graph IR does not compile |
| `GE_PATCH_AUTHORITY_EXPANSION` | patch widens effective capability |
| `GE_PATCH_BUDGET_EXCEEDED` | required reservation does not fit |
| `GE_PATCH_STATE_CONFLICT` | target node/output state makes append unsafe |
| `GE_PATCH_UNSUPPORTED` | requested feature is outside this protocol revision |

Compiler diagnostics for the candidate graph are retained under
`GE_PATCH_GRAPH_INVALID`; they are not flattened into an unstructured message.
Human messages may improve without changing the code, path, or deterministic
issue order within this protocol revision.

Outer diagnostic phase order is the numbered patch-transition order. Portable
snapshot issues use deterministic traversal (array declaration order, object
keys by Unicode code point). JSON Schema issues are sorted by JSON Pointer,
then by the fixed keyword order `type`, `const`, `enum`, `required`,
`additionalProperties`, `propertyNames`, `pattern`, `minimum`, `maximum`,
`minLength`, `maxLength`, `minItems`, `maxItems`, `uniqueItems`,
`minProperties`, `maxProperties`, `allOf`, `anyOf`, `oneOf`, `not`, `$ref`, then any future
keyword by Unicode code point, and finally canonical keyword parameters.
Candidate-graph compiler issues retain the
compiler's already versioned order as one nested issue list. Host validator
iteration order and localized message text are never conformance inputs.

## 13. Persistence, resume, replay, and fork

The append-only controller event log is authoritative. The exact event schema
is [cycle-controller-event.schema.json](cycle-controller-event.schema.json),
with contract version `cycle-controller-recovery/v1alpha1`. The exact rebuildable
checkpoint/fold schema is
[cycle-controller-checkpoint.schema.json](cycle-controller-checkpoint.schema.json).

These are separate contracts. The existing `events/v1alpha1`,
`checkpoints/v1alpha1`, and `scheduler-recovery/v1alpha1` contracts continue to
support only one immutable revision-1 DAG. Their `RunCreated` shape, open
`data`, graph-revision checks, and fold MUST NOT be reused or extended by
interpretation. The generic `GraphPatched` enum value remains reserved
vocabulary and is not a D7 event.

### 13.1 Controller and request identity

The controller identity body is closed and its `controllerHash` is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-controller/v1alpha1\0") ||
  UTF8(canonical({
    policy,
    objectiveHash,
    keyStrategyId,
    rubricIdentity,
    authorityCeilingHash,
    pricingPolicyHash,
    initialGraphRevision,
    initialGraphHash,
    initialRevisionHash
  }))
)
```

Every field is required; an unused key strategy or rubric uses an explicit
versioned `"none/.../v1"` identity, never omission. `objectiveHash` is the
SHA-256 of the exact canonical objective payload in the request. The separate
`requestHash` additionally binds host/stream/checkpoint identity, activity
implementations and bounds, payload profile, patch limits, and fork lineage.
Resume MUST match both hashes before acquiring a lease or appending an event.

Changing policy, key strategy, rubric, objective, authority ceiling, pricing,
implementation, activity binding, patch limit, payload profile, host
relationship, or lineage changes at least one bound hash. A caller cannot
attach new semantics to old history while claiming deterministic resume or
replay.

### 13.2 Event envelope, chain, CAS, and lease identity

Every event is a closed object with the exact controller/host/request identity,
current graph revision, strict timestamp, sequence, expected previous sequence,
previous event hash, lease identity, payload disposition, payload hash, closed
type-specific data, and record hash.

Sequence zero is exactly `ControllerCreated`, has
`expectedPreviousSequence: -1`, `previousEventHash: null`, and `lease: null`.
For every later event at sequence `S`:

- `expectedPreviousSequence == S - 1` is the event-store CAS version supplied
  to the append;
- `previousEventHash` equals the prior event's `recordHash`;
- `payloadHash == SHA-256(canonical(data))`; and
- the append is rejected if the store tail is not exactly `S - 1`.

`recordHash` is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-event/v1alpha1\0") ||
  UTF8(canonical(event-with-recordHash-omitted))
)
```

Thus payload mutation, envelope mutation, reorder, truncation, fork-prefix
substitution, and CAS drift are independently detectable. Hashes are integrity
facts, not signatures or authorization.

Every post-creation mutation event carries the exact active lease object:
`leaseId`, `holderId`, positive `leaseEpoch`, positive `fencingToken`,
`acquiredAt`, and `expiresAt`. A new acquisition after release, expiry, crash,
or takeover MUST use a strictly larger epoch and fencing token than every prior
lease in the stream. Renewal preserves lease ID, holder, epoch, fencing token,
and acquisition time while extending expiry. A stale, expired, released, or
lower-fenced holder cannot append or dispatch. `LeaseAcquired` is committed by
CAS before work; `LeaseReleased` is used only for a pause or voluntary handoff.
`ControllerTerminated` carries the active lease that authorizes its append and
atomically makes that lease inactive in the fold. No separate terminal release
can follow it because no event may follow terminal state. CAS
alone is not a distributed lease implementation, so native conformance must
exercise a real fencing provider before distributed execution is claimed.

### 13.3 Closed phase events and fold

The event type and `data` schema form one discriminator. Unknown fields and a
valid type paired with another type's data are invalid.

| Event | Authoritative fold effect |
| --- | --- |
| `ControllerCreated` | Stores the exact request, request identity, controller identity/body/hash, trusted start, and absolute deadline. |
| `LeaseAcquired` / `LeaseRenewed` / `LeaseReleased` | Changes only the fenced ownership projection under the rules above. |
| `RoundReserved` | Assigns the next contiguous iteration; stores and hashes the complete request-bound round plan; and atomically reserves its exact worst-case attempt/cost/dynamic-node maximum against the current revision. |
| `ActivityStarted` | Claims one exact phase attempt before caller code, with activity ID/key, input hash, side-effect class, and reservation ID. An unmatched start is an in-doubt activity after process loss. |
| `ActivityFailed` | Closes a claimed activity with stable code, retryability, in-doubt flag, and usage; it is not a dry discovery or implicit verdict. Budget counters change only through the corresponding settlement event. |
| `DiscoveryCommitted` | Atomically stores exact canonical batch bytes/hash/count, first-occurrence fresh keys, duplicate occurrences, ordered seen additions, usage, and duration. It closes the finder claim. |
| `CandidateEvaluationCommitted` | Stores one verdict per fresh key and the exact accepted/rejected/unknown partition. It closes the candidate-evaluator claim. |
| `ModeOutcomeCommitted` | Stores the deterministic until-dry fact or the recorded while/evaluator outcome. A non-deterministic condition/evaluator binds its activity key. |
| `BudgetReservationSettled` | Moves exact attempt/cost/structure units from one live reservation to committed cumulative totals. |
| `BudgetReservationReleased` | Releases the exact unused credit of one named completed phase, or the exact whole remainder for a closed round/failure/cancellation/rejection/bound, and stores the exact remainder and cumulative totals. A no-op release and a round commit with a nonzero remainder are invalid. |
| `PatchAccepted` | Stores exact canonical patch bytes/hash/ID, base, authenticated authority/policy snapshots, reservation outcome, empty diagnostics, and the exact resulting revision body/hash. The event revision is the new revision. |
| `PatchRejected` | Stores the same exact proposal identity and decision context, a stable rejection code, and ordered nonempty diagnostics; it has no resulting revision. |
| `RoundCommitted` | Stores the complete closed round projection and cumulative counters after all required facts and reservation closure. |
| `ControllerTerminated` | Stores the closed exit observation and exact result carrier, closes a fully settled incomplete round, moves any charged unmatched activity into the in-doubt projection, and atomically ends the lease. No event may follow it. |

Only `BudgetReservationSettled` changes committed budget counters. Usage inside
an activity result is evidence that must reconcile with settlement; it is not a
second debit. `requested == committed + released` is checked independently for
each patch decision, and every round reservation satisfies
`maximum == committed + released` before `RoundCommitted`.

One round is open at a time. A successful phase outcome or `ActivityFailed` is
followed by its exact `BudgetReservationSettled` fact before another activity
may start; unused capacity may be released as soon as its path is impossible.
The durable phase and allowed successor are:

```text
RoundReserved
  -> finder ActivityStarted
  -> DiscoveryCommitted
  -> finder settlement
  -> candidate-evaluator ActivityStarted
  -> CandidateEvaluationCommitted
  -> candidate-evaluator settlement
  -> ModeOutcomeCommitted (with a claimed condition/evaluator when required)
  -> mode-activity settlement when one was claimed
  -> optional patch-planner ActivityStarted
  -> PatchAccepted | PatchRejected
  -> patch-planner settlement
  -> exact phase-complete releases, when any
  -> one exact closing BudgetReservationReleased fact, when a remainder exists
  -> RoundCommitted
```

`ActivityFailed`, cancellation, deadline, or durability failure can terminate
from an allowed open phase, but cannot skip already committed seen additions,
invent a dry round, silently release budget, or reuse the assigned iteration.
Before a terminal append, every claimed attempt and in-doubt cost is settled
and every impossible remainder is released. `ControllerTerminated` then closes
the incomplete round without fabricating `RoundCommitted`; an unmatched,
already charged `ActivityStarted` is retained in `inDoubtActivities` so a fork
cannot mistake it for work that never started.

Patch bytes are stored as a closed inline payload containing
`canonicalJson`, exact UTF-8 byte length, and SHA-256. Both accepted and
rejected decisions retain them. On idempotent retry the runtime validates and
hashes the supplied document, performs the decided-ID lookup before stale-base
comparison, and returns the exact recorded decision only when canonical bytes
match. An accepted revision is folded only from `PatchAccepted`, in sequence,
after rechecking patch bytes/hash, base, graph hash, previous revision hash,
revision body, and revision hash. There is no parallel mutable revision table.

### 13.4 Checkpoint and recovery projection

A controller checkpoint is a cache over one validated event prefix. Its closed
envelope binds controller/host/stream/checkpoint identity, last sequence,
history-prefix hash, controller/request hashes, graph revision, lease,
truthful payload disposition, fold state, and content hash. `contentHash` is
SHA-256 of canonical checkpoint bytes with only `contentHash` omitted.

The fold state stores the exact request, start/deadline, current revision,
ownership, next iteration, globally seen and mutually exclusive verdict
categories, cumulative counters, every live reservation, decided patch IDs,
committed round projections, the exact plan for at most one open round/activity,
up to one unresolved external-effect identity in `inDoubtActivities`, and an
optional terminal observation/result. The in-doubt projection is a singleton
map keyed by the stable `activityKey`, not an append-only list of failed
attempts. An `ActivityFailed` with `inDoubt: true` inserts the claimed external
activity; another ambiguous attempt with the same key replaces it with the
higher attempt number; a successful outcome committed for that key removes it.
An activity bound to `sideEffects: "none"` can never enter this projection, and
a second unresolved key is invalid history because this controller serializes
claims and cannot safely advance past unresolved external work. Terminal state
requires a null lease, zero live reservations, no open round, an exact terminal
observation/result pair, and any charged unresolved external activity in the
singleton; active state has no terminal observation or result.

The event stream remains authoritative. A missing checkpoint triggers a full
fold. A stale checkpoint may seed only its verified prefix and then folds the
suffix. Invalid shape/hash, ahead-of-tail sequence, wrong prefix hash,
controller/request/revision mismatch, category mismatch, or projection
inconsistency rejects the checkpoint for acceleration and emits a structured
metadata-only warning; it never hides event corruption, supplies a null, or
authorizes work.

Resume validates schema, sequence/CAS chain, payload/record hashes, lease
history, controller/request identity, exact stored payload bytes, budgets,
phase order, seen categories, patch lineage, and terminal projection before a
new lease or external call. Crash behavior is phase-exact:

- before `RoundReserved`, nothing from that iteration exists;
- after `RoundReserved`, resume continues the same iteration and reservation;
- an open `ActivityStarted` is in doubt;
- after `DiscoveryCommitted`, finder output and every seen addition are reused
  and the finder is never rerun;
- after candidate evaluation or mode outcome commit, that decision is never
  recomputed;
- after `PatchAccepted`, exact stored patch bytes rebuild the revision and the
  planner/compiler/policy decision is not rerun;
- after `PatchRejected`, exact retry returns the rejection and the controller
  cannot ask for alternate bytes in that round;
- after `RoundCommitted`, convergence is selected from the committed record;
  and
- after `ControllerTerminated`, resume is read-only, returns the stored result,
  and preserves any charged unmatched activity as in doubt.

#### Durable-boundary fault lattice

The executable fault lattice is derived from the closed event vocabulary in
`cycle-controller-event.schema.json`; it is not a hand-maintained selection of
currently convenient controller paths. For each of the 17 event types, the
runtime publishes these canonical stages:

| Stage | Canonical boundary | Durable fact when the hook runs |
|---|---|---|
| before event construction | `event:{type}:before-construction` | candidate event is absent |
| after event construction | `event:{type}:after-construction` | candidate event is absent |
| after prospective fold | `event:{type}:after-fold-before-cas` | candidate event is absent |
| before store commit | `store:event:{type}:before-commit` | candidate event is absent |
| after store commit | `store:event:{type}:after-commit-before-return` | event is authoritative |
| after store return | `event:{type}:after-store-before-state` | event is authoritative |
| after state update | `event:{type}:after-state-before-dispatch` | event and projection agree |
| before checkpoint construction | `checkpoint:{type}:before-construction` | event is authoritative; checkpoint may be absent |
| after checkpoint construction | `checkpoint:{type}:after-construction-before-save` | event is authoritative; checkpoint is absent |
| after checkpoint save | `checkpoint:{type}:after-save-before-ack` | event and checkpoint are durable |
| terminal result delivery | `terminal:ControllerTerminated:during-delivery` | terminal event is authoritative |

The terminal-delivery stage applies only to `ControllerTerminated`; the other
ten stages apply to every event because an interval checkpoint may follow any
committed event. Crossing these stages with process loss, store error, timeout,
cancellation, and commit-then-throw creates 855 executable obligations over 171
unique boundaries. The retained fixture records the canonical 163,770-byte
matrix with SHA-256
`235a81ff9342d91541d092f2306600feece980fb2c6eec1f2cc098273cbc3a23`.
TypeScript and Python must generate that matrix independently and compare every
entry in conformance. Adding an event without extending the schema, runtime
vocabulary, fixture, and matrix therefore fails validation.

Fault hooks are deterministic test and simulation controls, not evidence that
an in-memory adapter is crash durable. A production adapter must establish the
same before/after-commit facts with its transaction and fsync contract. The
legacy `event:{type}:before-cas` and `event:{type}:after-cas` aliases remain
observable for v1alpha1 tests, but new retained evidence uses the canonical
names above.

The stable cycle activity key is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-activity/v1alpha1\0") ||
  UTF8(canonical({
    controllerRunId, controllerHash, iteration, phase, activityId, inputHash
  }))
)
```

Attempt is excluded. A correctly declared `none` activity may retry, and an
`idempotent` activity may retry only with the same key passed to the external
system. Resume reuses an unmatched durable claim with its existing attempt and
key; it does not append a second `ActivityStarted` merely because the process
lost the uncommitted result. An ambiguous idempotent retry coalesces into the one in-doubt identity;
a later successful outcome for the same key resolves it. An open or failed
in-doubt `non-idempotent` activity is `IN_DOUBT_SIDE_EFFECT` and resume may not
invoke it automatically. A fork cannot continue with any inherited external
in-doubt identity: the child has a new controller run ID and therefore cannot
derive the parent's activity key required for a safe idempotent retry. The
block occurs after the child creation event binds lineage but before a child
lease or external dispatch. The old claim remains charged, late effects remain
at-least-once, and an operator reconciliation/approval event is later work.

#### 13.4.1 Terminal in-doubt resolution

The first resolution protocol is deliberately narrower than general activity
recovery. It may resolve exactly one external in-doubt identity only after the
controller has reached a durable terminal result. It does not invent an
activity output, alter seen or verdict state, refund charged usage, rewrite the
terminal result, or authorize an open non-idempotent claim to rerun.

The closed `CycleInDoubtResolution` command contains:

- a stable `resolutionId` used as its idempotency key;
- the controller run, controller hash, request hash, and event stream identity;
- the exact pre-resolution tail sequence and record hash;
- the exact unresolved `activityKey`;
- either `confirmed-applied` or `confirmed-not-applied`;
- a hash of the operator's external evidence; and
- principal, grant, policy, and lease-holder hashes in a closed authority
  snapshot.

Its command hash is:

```text
SHA-256(
  UTF8("graph-engineering/cycle-in-doubt-resolution/v1alpha1\\0") ||
  UTF8(CanonicalJSON(command))
)
```

An `InDoubtActivityResolved` event carries the complete command and command
hash. Its event lease is a transient administrative fence: both lease epoch and
fencing token must be strictly greater than every prior lease, the event time
must be within the lease interval, the lease ID must be new, and SHA-256 of the
UTF-8 lease holder ID must equal `authoritySnapshot.leaseHolderHash`. The event
atomically consumes that fence but leaves the terminal controller unleased.

The command's expected sequence and expected history-prefix hash must equal the
event immediately before the resolution. The target activity key must equal the
one singleton entry. The fold then removes the singleton and changes no other
semantic result or accounting projection. A checkpoint after resolution binds
the new event tail and contains an empty in-doubt projection while retaining the
original terminal result bytes.

Replaying a byte-identical command with the same `resolutionId` returns the
already committed resolution with zero new events. Reusing that ID with any
different command byte is an idempotency conflict. The idempotent replay check
precedes stale-tail and stale-fence checks because it performs no mutation.
Wrong activity keys, absent uncertainty, nonterminal histories, stale sequence
or history hashes, stale fences, authority/holder substitution, and malformed
closed commands fail before append. A second resolution event in forged history
is invalid because the first event has already consumed the singleton.

Resolving an interrupted nonterminal activity, converting confirmed effects
into semantic activity outputs, and approval workflows that can authorize a
retry remain separate protocol extensions. Until they are specified, resume of
an open non-idempotent activity remains blocked.

### 13.5 Replay and fork

Replay validates and folds recorded candidate batches, decisions, patches,
counters, elapsed values, and exit reason. It MUST NOT call a finder,
evaluator, condition, planner, compiler plugin, clock, random source, model,
tool, policy service, or authority service. Replay performs no external work,
acquires no execution lease, and appends no event.

A fork first validates the parent through the exact `parentSequence` and
`parentHistoryHash` in the new request's closed lineage. The child receives a
new controller run/stream/request hash and copies only the event-derived prefix
projection: current revision, seen/verdict categories, committed rounds,
counters, and any external in-doubt activity status. It does not copy a lease,
mutable reservation ownership, or future parent facts. The child and parent
then diverge; additions in either cannot affect the other. A prefix ending in
an open idempotent or non-idempotent external activity is coalesced into the
child's singleton in-doubt projection and blocks child lease/dispatch because
the child cannot retry under the parent's stable activity key.

### 13.6 Payload protection and D9 boundary

`cycle-controller-recovery/v1alpha1` deliberately stores authoritative
objective, candidate, seen-key, verdict, and patch material inline. Every event
and checkpoint therefore requires:

```json
{
  "payloadDisposition": "inline-unredacted",
  "redacted": false
}
```

Every inline payload repeats `disposition: "inline-unredacted"` and
`redacted: false`. The request requires
`cycle-controller-inline-payloads/v1alpha1` plus an authenticated
`inlineRiskAuthorizationHash`. Hashing, canonical encoding, or putting exact
bytes in an event/checkpoint is not redaction or protection. User-facing logs,
traces, errors, and support output remain metadata-only by default and MUST NOT
copy these bytes.

This truthfully specified alpha carrier does not satisfy D9, the default
privacy profile, or stable release. It does not accept `ProtectedValueRef`,
ciphertext, a redaction token, an opaque artifact, or `redacted: true` as an
authoritative substitute. The future protected mapping requires a separately
versioned controller request/event/checkpoint contract aligned with
`redaction-semantics.md`, native guard/store/key implementation, and migration
fixtures. It cannot silently change v1alpha1 hashes or omit recovery data.

## 14. Cross-language conformance

TypeScript and Python MUST agree on:

- policy acceptance and ordered diagnostics;
- first-occurrence seen-set and duplicate classification;
- dry-round counting and reset;
- every exit reason and status projection;
- hard-limit precedence and exact counters;
- patch schema verdicts and diagnostic paths;
- canonical patch, candidate graph, and revision hashes;
- stale-base and duplicate-patch behavior;
- dry-run versus apply observations; and
- resume/replay results without re-execution.

Required hostile cases include repeated rejected findings, duplicate keys in one
round, cancellation at every boundary, a budget one unit below/at/above the
reservation, stale base races, ID shadowing, back-edges, incoming edges to
started nodes, authority expansion, unsupported stream edges, malicious deep
patches, and corrupted histories. The offline schema corpus additionally
rejects unknown fields, partial phase records, unsafe integers, revision
overflow, false redaction claims, authority-widening representations, wrong
sequence/CAS, wrong phase, payload/record/patch/revision hash drift, duplicate
event IDs, under-reserved round plans, lying settlement totals, terminal
precedence drift, ahead checkpoints, prefix substitution, same-count key or
request substitution, and counter drift.

[`cycle-controller.case.json`](conformance/cycle-controller.case.json) freezes
policy/request/result/revision documents and their domain hashes.
[`cycle-controller-durable.case.json`](conformance/cycle-controller-durable.case.json)
freezes a 16-event accepted-patch history, a terminal cancellation with a
charged open patch planner retained in doubt, a terminal failed-finder history,
global-seen/dry-convergence folds, inclusive hard-stop/precedence folds, all
remaining event payload shapes, frozen terminal/checkpoint hashes, hostile
mutations, recovery boundaries, and fork-prefix observations. Its explicit
coverage map binds all four `D7-CYCLE-SPEC-024` expected-test groups to named
cases. These are protocol and offline validator evidence only.

The native implementations MUST pass the shared fixtures without one runtime
delegating execution or number formatting to the other language.

## 15. Contract acceptance and implementation boundary

`D7-CYCLE-SPEC-024` is a machine-contract task. Its acceptance boundary is the
standalone request/effective-policy/result/revision carriers, the separate
closed event payloads and envelope, hash/CAS/lease chain, checkpoint and exact
event-prefix fold, persisted closed round plans, fully settled incomplete
termination with retained in-doubt activities, observable exit precedence,
crash/resume/replay/fork rules, exact patch bytes/lineage, truthful inline
payload boundary, and the four registry-named expected-test groups. Native
execution is explicitly outside that task's artifact and test scope.

The runtime/product boundary remains open under `D7-TS-CYCLES-025`,
`D7-PY-CYCLES-026`, and `D7-CYCLE-CONFORMANCE-027`: public schedulers still
execute immutable acyclic graphs, the TypeScript pattern package only
statically unrolls a fixed loop, and no native controller, dynamic patch
applier, durable store join, or executable cross-language reporter consumes
this contract. Until those independent implementations pass the shared
transition/recovery suite, documentation and CLI output MUST label bounded
dynamic cycles and GraphPatch execution as unavailable. Accepting 024 therefore
unblocks its native dependants but does not complete master-plan Day 7 or close
release rows `T08`, `T15`, `T17`, `T18`, or `T21`.
