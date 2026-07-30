# Integrated barrier and durable decision semantics v1alpha1

Status: contract candidate, revision 1. `implementationClaim: false`. No
TypeScript or Python runtime implements this contract yet. Freezing this file
does not grant any barrier, quorum, deadline, human-gate, or decision-replay
capability claim.

The normative corpus is `spec/conformance/integrated-barrier.case.json`.

## Scope

Section 11.3 of the master plan requires moving the pure route and barrier
evaluators into scheduler-integrated durable behavior. The integrated router
compiler, lowering, ordinary execution, and pre-dispatch capability gate were
accepted separately and are fixed by
[integrated-router-semantics.md](integrated-router-semantics.md). That milestone
explicitly excluded a dedicated durable decision identity, zero-rejudge replay,
integrated barriers, quorum, abstention, deadlines, late-arrival policy, and
barrier cancellation propagation. This revision freezes exactly that remainder.

This revision freezes:

- direct `IntegratedBarrierPolicy` validation on `barrier` nodes;
- the closed six-member arrival-disposition vocabulary, including `abstained`
  and `unknown`;
- the `BarrierVote` carrier and retained-vote requirement for quorum barriers;
- exact-integer satisfaction arithmetic for `all`, `minimum`, `percentage`, and
  `quorum`;
- deterministic deadline arming and settlement against an injected clock;
- the closed `onUnsatisfied` resolution set, in which insufficient evidence
  never becomes an implicit pass;
- late-arrival behavior after a committed decision;
- cancellation propagation across a waiting barrier;
- the frozen `BarrierSatisfied` and `RouteSelected` durable decision documents,
  their domain-separated decision identities, and zero-rejudge replay; and
- compiler diagnostics `GE1421` through `GE1424`.

This revision does not add human-approval resumption authority, verifier
rubrics, judge panels, budget accounting, distributed barrier coordination,
provider calls, or wall-clock timing. A `human` resolution suspends the run and
stops; the authority that may later resume it is `D9-APPROVAL-077` work and is
an explicit non-claim here.

The published pure evaluator `evaluateSettledBarrier` and its
`settled-barrier.case.json` corpus are unchanged. The integrated barrier is a
strict superset defined at the scheduler boundary; it does not alter, weaken, or
reinterpret the standalone primitive.

## Canonical declarations

### Barrier policy

A barrier is an ordinary Graph IR node with `kind: "barrier"`. Its `config` is
directly the policy. No `config.policy` wrapper, no inference from edges, and no
inference from metadata is permitted.

```text
IntegratedBarrierPolicy {
  kind: "all" | "minimum" | "percentage" | "quorum"
  minimum?: integer 1..9007199254740991      // required iff kind == "minimum"
  basisPoints?: integer 1..10000             // required iff kind == "percentage"
  quorum?: {                                 // required iff kind == "quorum"
    accepts: integer 1..9007199254740991
    countAbstainAsParticipant: boolean
  }
  deadline?: {                               // optional for every kind
    afterMs: integer 1..9007199254740991
  }
  onUnsatisfied: "fail" | "unknown" | "human"
  lateArrival: "ignore" | "reject"
}
```

`onUnsatisfied` and `lateArrival` are required for every kind. There is no
default. A policy that omits either is invalid, because a silently defaulted
unsatisfied barrier is exactly the implicit pass this contract forbids.

Numeric integers are finite mathematical integers within the portable JSON
safe-integer range, so JSON `1.0` is accepted as integer one in both languages
while booleans are never integers. Objects are exact: unknown fields,
duplicates, and explicit null optionals are invalid. Omission, not null, selects
optional behavior.

Graph capture and the Graph envelope run before this validator. Accessors,
proxies, sparse arrays, non-data properties, cycles, and other values that
cannot enter portable Graph IR are `GE1007_INVALID_GRAPH` and are never
relabeled `GE1421`. A barrier's portable null, scalar, or array config is
`GE1421` at the config root. Non-barrier configs are not interpreted as
policies.

### Barrier vote

Quorum barriers consume votes. An upstream node bound to a quorum barrier MUST
produce the exact four-or-five-field carrier:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/barrier/v1alpha1",
  "kind": "BarrierVote",
  "verdict": "accept",
  "confidenceBasisPoints": 9000,
  "evidence": {"citation": "spec/integrated-barrier-semantics.md"}
}
```

`verdict` is one of `accept`, `reject`, `abstain`, `unknown`.
`confidenceBasisPoints` is an optional integer in `1..10000`. `evidence` is
optional portable JSON bounded by the graph's existing payload limits. Property
order is immaterial. Missing or additional fields, wrong types, an unknown
verdict, or an out-of-range confidence make the value a malformed vote.

A malformed vote on a quorum barrier is the non-retryable node failure
`INVALID_BARRIER_VOTE` after exactly one attempt. It is never coerced to
`abstain` or `unknown`, and it never counts as a participant.

Non-quorum barriers do not inspect upstream values and MUST NOT require a vote.

## Arrival dispositions

The closed disposition vocabulary has exactly six members:

| Disposition | Produced when |
|---|---|
| `succeeded` | upstream node succeeded; for quorum, its vote verdict is `accept` |
| `failed` | upstream node failed; for quorum, its vote verdict is `reject` |
| `missing` | upstream node settled without an attempt (`ROUTE_NOT_SELECTED`, `UPSTREAM_FAILED`, `UPSTREAM_UNKNOWN`) or was cancelled before settling |
| `timed_out` | upstream node was still unsettled when the barrier deadline elapsed |
| `abstained` | quorum only; vote verdict is `abstain` |
| `unknown` | quorum only; vote verdict is `unknown` |

`abstained` and `unknown` are unreachable for `all`, `minimum`, and
`percentage` barriers. An implementation MUST NOT synthesize them there.

Each incoming edge of a barrier contributes exactly one disposition entry keyed
by the source node ID. Two incoming edges from the same source node are already
rejected by the existing duplicate-target rules of the compiler and are not
re-specified here.

Disposition entries are ordered by the barrier's incoming-edge declaration
order in the compiled graph. This order is normative and appears verbatim in
the decision document.

## Satisfaction arithmetic

Let `total` be the number of disposition entries, and let `succeeded`,
`failed`, `missing`, `timedOut`, `abstained`, and `unknown` be their counts.

- `total == 0` is unsatisfied with reason `NO_ITEMS`. This is unreachable
  through the compiler, which rejects an input-free barrier as `GE1423`, but it
  remains defined for direct evaluator conformance.
- `all`: satisfied iff `succeeded == total`; reason `ALL_SUCCEEDED` or
  `ALL_NOT_SUCCEEDED`.
- `minimum`: if `minimum > total`, unsatisfied with reason
  `MINIMUM_EXCEEDS_TOTAL`; otherwise satisfied iff `succeeded >= minimum`,
  reason `MINIMUM_MET` or `MINIMUM_NOT_MET`.
- `percentage`: satisfied iff `succeeded * 10000 >= total * basisPoints`;
  reason `PERCENTAGE_MET` or `PERCENTAGE_NOT_MET`. Both products remain exact
  safe integers, so no floating-point ratio is ever computed.
- `quorum`: let
  `participants = total - (countAbstainAsParticipant ? 0 : abstained)`.
  If `accepts > participants`, unsatisfied with reason
  `QUORUM_EXCEEDS_PARTICIPANTS`; otherwise satisfied iff
  `succeeded >= accepts`, reason `QUORUM_MET` or `QUORUM_NOT_MET`.
  `unknown` always counts as a participant and never as an accept.

The closed reason-code set has exactly eleven members: `NO_ITEMS`,
`ALL_SUCCEEDED`, `ALL_NOT_SUCCEEDED`, `MINIMUM_MET`, `MINIMUM_NOT_MET`,
`MINIMUM_EXCEEDS_TOTAL`, `PERCENTAGE_MET`, `PERCENTAGE_NOT_MET`, `QUORUM_MET`,
`QUORUM_NOT_MET`, `QUORUM_EXCEEDS_PARTICIPANTS`.

Deadline elapse is not a reason code. It is the separate boolean
`deadlineElapsed` in the decision document, because a deadline changes which
dispositions exist rather than which policy rule decided.

## Deadline and the deterministic clock

Barriers never read a wall clock. The scheduler is constructed with a monotonic
millisecond clock source. Conformance drives it with a scripted tick list; no
conformance case may depend on real elapsed time, timer scheduling, or
concurrency interleaving.

1. A barrier is *armed* at the first scheduler quiescence point at which at
   least one of its incoming edges has bound a settled upstream result. The
   observed clock value at that instant is `armedAtMs`.
2. A barrier without `deadline` is never deadline-settled; it decides when every
   incoming edge has a disposition.
3. An armed barrier with `deadline` is evaluated at every later quiescence
   point. When `clock.nowMs() - armedAtMs >= deadline.afterMs` and at least one
   incoming edge is still unsettled, every unsettled source contributes
   `timed_out` and the barrier decides immediately with
   `deadlineElapsed: true`.
4. A barrier that becomes complete before its deadline decides with
   `deadlineElapsed: false`, even if the clock later passes the deadline.
5. `decidedAtMs` is the clock value observed at the deciding quiescence point.
   `decidedAtMs >= armedAtMs` always holds.

A quiescence point is the state after a node settles, after the driver delivers
a clock tick, or after cancellation is observed. Deadline evaluation therefore
requires no timers and produces identical results in both languages for the same
scripted tick list.

## Resolution

A satisfied barrier succeeds. Its output is the frozen decision document
described below, and its outgoing edges bind normally.

An unsatisfied barrier NEVER succeeds and NEVER binds an output. Its resolution
is exactly the declared `onUnsatisfied` member:

- `fail` — the barrier node fails with the non-retryable code
  `BARRIER_NOT_SATISFIED` after zero executor attempts. Descendants inherit the
  existing `UPSTREAM_FAILED` zero-attempt terminal.
- `unknown` — the barrier node settles with the terminal status `unknown`. This
  is neither success nor failure. Descendants reachable only through it inherit
  the zero-attempt terminal `UPSTREAM_UNKNOWN`. The run does not fail solely
  because of it.
- `human` — the barrier node settles with the terminal status `awaiting_human`.
  The scheduler emits `HumanInputRequested` carrying the decision document,
  schedules no descendant, and stops. Whether and how such a run resumes is
  `D9-APPROVAL-077` authority and is not specified here. A `human` resolution
  MUST NOT be reported as satisfied, succeeded, failed, or cancelled.

Run terminal precedence is extended, highest first: `failed`, `cancelled`,
`awaiting_human`, `unknown`, `succeeded`. A run with any failed node is failed
even when another barrier resolved to `unknown` or `awaiting_human`.

`UPSTREAM_UNKNOWN` is excluded from graph failure codes exactly as
`ROUTE_NOT_SELECTED` already is. An inactive named graph output makes output
binding incomplete and the run non-successful without inventing a node failure.

## Cancellation and late arrival

Cancellation observed while a barrier is armed but undecided settles the barrier
node as cancelled with zero attempts, emits no decision event, and propagates
the existing cancellation terminal to descendants. A cancelled barrier never
produces a partial decision document.

After a decision is committed, an upstream that settles later is a *late
arrival*:

- `ignore` — the committed decision is immutable. The late node's own
  `NodeSucceeded` or `NodeAttemptFailed` is still recorded, the barrier is not
  re-evaluated, and no second decision event is appended.
- `reject` — the late arrival is the non-retryable run failure
  `BARRIER_LATE_ARRIVAL`, naming the barrier node and the late source node.

A late arrival never mutates `total`, any count, any ID list, any vote, or the
decision identity.

## Durable decision documents

### Barrier decision

`BarrierSatisfied` event `data` is the frozen document below. The event type
name is retained from the published event schema for compatibility; it is
emitted for every committed decision, satisfied or not, and `satisfied` carries
the truth.

```text
BarrierDecision {
  barrierNodeId: string
  policyHash: lowercase hex SHA-256
  decisionId: lowercase hex SHA-256
  armedAtMs: integer >= 0
  decidedAtMs: integer >= armedAtMs
  deadlineElapsed: boolean
  satisfied: boolean
  reasonCode: one of the eleven closed reason codes
  resolution: "satisfied" | "failed" | "unknown" | "awaiting_human"
  total, succeeded, failed, missing, timedOut, abstained, unknown: integer >= 0
  acceptedIds, failedIds, missingIds, timedOutIds, abstainedIds, unknownIds:
    string[] in incoming-edge declaration order
  votes?: BarrierVoteRecord[]   // present iff policy kind == "quorum"
}

BarrierVoteRecord {
  sourceNodeId: string
  verdict: "accept" | "reject" | "abstain" | "unknown" | "not-cast"
  confidenceBasisPoints?: integer 1..10000
  evidenceHash?: lowercase hex SHA-256 of the canonical evidence value
}
```

The six count fields MUST sum to `total`, and the six ID lists MUST partition
the disposition entries. `votes` preserves incoming-edge declaration order and
contains exactly one record per disposition entry. Raw evidence is never
embedded in the event; only `evidenceHash` is. Evidence retention is governed by
the redaction contract and is not re-specified here.

`BarrierVoteRecord.verdict` has five members while `BarrierVote.verdict` has
four. The difference is deliberate and load-bearing. A quorum barrier can
legitimately hold disposition entries that produced no vote at all: `missing`
entries arising from route pruning, upstream failure, upstream unknown or
cancellation, and `timed_out` entries arising after the deadline elapsed.
Because `votes` is a complete one-record-per-entry census rather than a list of
received ballots, those entries need a truthful record, and `not-cast` is it.
An upstream node can never cast `not-cast`; it exists only in the decision
document. Without this member the one-record-per-entry requirement would be
unsatisfiable, and an implementation would be forced either to drop entries
from the census or to invent a ballot nobody cast.

A `not-cast` record's key set MUST be exactly `sourceNodeId` and `verdict`. It
MUST NOT carry `confidenceBasisPoints` and MUST NOT carry `evidenceHash`,
because there is no ballot from which either could be derived; materializing
one would be inventing the ballot the member exists to deny. Conversely, a
`missing` or `timed_out` disposition MUST be recorded as `not-cast` and never as
a cast verdict, and a cast disposition MUST NEVER be recorded as `not-cast`.

`BarrierVoteRecord.confidenceBasisPoints` is optional with the range
`1..10000`, while `RouteDecision.confidenceBasisPoints` is required with the
range `0..10000` or `null`. The asymmetry is intentional: a vote signals
"no confidence supplied" by omitting the member, whereas the published route
evaluator always materializes its field and signals absence with `null`. Neither
side may be changed to match the other without breaking an already published
surface.

### Route decision

`RouteSelected` event `data` is the frozen document below. It wraps the already
published eight-field `RouteSelectionResult` without altering it.

```text
RouteDecision {
  routerNodeId: string
  policyHash: lowercase hex SHA-256
  decisionId: lowercase hex SHA-256
  routed: boolean
  reasonCode: the existing eight-member RouteSelectionReasonCode
  requestedRoutes, selectedRoutes, unknownRoutes: string[]
  confidenceBasisPoints: integer 0..10000 or null
  usedDefault: boolean
  escalated: boolean
}
```

`reasonCode` mirrors the published `RouteSelectionReasonCode` exactly —
`REQUESTED_ROUTES_SELECTED`, `DEFAULT_SELECTED_NO_REQUEST`,
`DEFAULT_SELECTED_UNKNOWN_ROUTE`, `ESCALATION_SELECTED_LOW_CONFIDENCE`,
`NO_REQUESTED_ROUTE`, `UNKNOWN_ROUTE`, `MULTIPLE_ROUTES_FOR_SINGLE`,
`MULTICAST_LIMIT_EXCEEDED` — and must not diverge from
`packages/primitives/src/types.ts` or
`python/src/graph_engineering/primitives/router.py`.

`confidenceBasisPoints` is the single member of the eight-field result whose
absence is carried as explicit `null` rather than omission, because the existing
evaluator always materializes the field. The omit-if-absent rule that governs
diagnostic projections does not apply to it.

### Policy hash

`policyHash` is lowercase hex `SHA-256` over the domain-separated framing

```text
frame("graphengineering.policy.v1alpha1")
frame(<"barrier" | "router">)
frame(canonicalSerialize(policy))
```

where `frame(s)` is `uint32be(byteLength(utf8(s))) || utf8(s)` and
`canonicalSerialize` is the existing canonical Graph IR serialization. Explicit
byte lengths make concatenation injective, so no field boundary can be forged by
crafted content.

### Decision identity

`decisionId` is lowercase hex `SHA-256` over

```text
frame("graphengineering.barrier-decision.v1alpha1")   // or .route-decision.
frame(runId)
frame(decimal(graphRevision))
frame(nodeId)
frame(canonicalSerialize(document without decisionId))
```

The document is serialized with the existing canonical key order, so neither
language may depend on object insertion order, locale comparison, platform
integer width, or implementation-specific JSON formatting.

## Zero-rejudge replay

A committed decision is authoritative forever.

1. On resume, replay, or fork, the scheduler folds the durable history before
   scheduling. Every `RouteSelected` and `BarrierSatisfied` event it finds
   yields a committed decision for that node.
2. A node with a committed decision MUST NOT be re-evaluated. The scheduler
   MUST NOT call its executor, MUST NOT recompute selection or satisfaction,
   MUST NOT re-read upstream values, and MUST NOT append a second decision
   event.
3. Before adopting a committed decision, the scheduler MUST compare its
   `policyHash` to the hash of the currently compiled policy for that node. A
   mismatch is the non-retryable run failure `DECISION_POLICY_DRIFT`, naming the
   node, the recorded hash, and the current hash. It is never silently
   re-judged.
4. The scheduler MUST also recompute `decisionId` from the adopted document and
   the current `runId`/`graphRevision`/`nodeId`, and reject a mismatch as
   `DECISION_IDENTITY_MISMATCH`. A forged or transplanted decision cannot be
   adopted.
5. Two committed decision events for one node in one run is
   `DUPLICATE_DECISION`, non-retryable.
6. Conformance asserts an executor call count of exactly zero for every node
   with a committed decision, in both languages.

Fork inherits committed decisions from its parent lineage. Because
`decisionId` binds `runId`, a forked run recomputes and re-emits its own
decision identity for any node it re-executes, and a parent decision adopted
verbatim by a child run is a `DECISION_IDENTITY_MISMATCH` rather than a silent
reuse.

## Compiler diagnostics

Public entry points remain TypeScript `compileGraph(document)` and Python
`try_compile_graph(document)`/`compile_graph(document)`.

| Code | Meaning | Base location |
|---|---|---|
| `GE1421_INVALID_BARRIER_POLICY` | admitted barrier config is not an exact policy | config root for non-object, otherwise first invalid descendant; node ID |
| `GE1422_BARRIER_POLICY_KIND_MISMATCH` | a field required by `kind` is absent, or a field forbidden by `kind` is present | the offending member path; node ID |
| `GE1423_BARRIER_NO_INPUTS` | barrier node has zero incoming edges | `#/nodes/{i}`; node ID |
| `GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS` | `minimum` or `quorum.accepts` exceeds the barrier's incoming-edge count | `/minimum` or `/quorum/accepts`; node ID |

"First invalid descendant" is the same deterministic rule the router pass
already uses: unknown keys first in Unicode code-point order, then
required-or-present fields in contract order, with array elements by increasing
index. The corpus freezes concrete paths. Messages are human-facing but must
name the barrier node.

"Contract order" is normatively the declaration-block order of the policy given
above:

```text
kind, minimum, basisPoints, quorum, deadline, onUnsatisfied, lateArrival
```

It is deliberately **not** the `properties` order of
`integrated-barrier-policy.schema.json`, which lists the required resolution
members before the per-kind threshold members. The two orders disagree: for
`{kind: "minimum", minimum: 0, lateArrival: "ignore"}` the declaration order
yields `/minimum` while the schema order would yield `/onUnsatisfied`. The
normative text wins, the schema `properties` order carries no diagnostic
meaning, and the corpus freezes witness cases for exactly this disagreement.

### Pass boundary and ordering

The compiler pipeline becomes:

1. canonical capture and Graph envelope (`GE1007`, early return);
2. declaration identity and reference diagnostics (`GE1001`..`GE1004`,
   `GE1008`, `GE1009`);
3. topology and cycle (`GE1005`, early return on cycle);
4. entrypoint and reachability (`GE1010`, `GE1006`);
5. graph policies (`GE1101`, `GE1102`);
6. the integrated router pass (`GE1401`..`GE1407`);
7. **this barrier pass (`GE1421`..`GE1424`)**; then
8. strict typed ports (`GE1201`..`GE1208`).

Within the barrier pass, diagnostics are emitted by category in
`GE1421`, `GE1422`, `GE1423`, `GE1424` order, and within each category in node
declaration order.

Suppression is local and forms a chain. `GE1424` is evaluated only for a policy
that is both shape-exact and cardinality-exact, so:

- `GE1421` on a node suppresses `GE1422` and `GE1424` for that same node,
  because a policy that is not an exact object has no kind and no threshold to
  compare;
- `GE1422` on a node suppresses `GE1424` for that same node, because a policy
  whose threshold member is absent or belongs to a different kind has no
  threshold to compare against the incoming-edge count; and
- neither suppresses `GE1423` for that node, because the incoming-edge count is
  a property of the graph rather than of the policy, and it never suppresses any
  diagnostic for another node or any later pass.

Portable diagnostic projection is unchanged: visit `code`, `path`, `nodeIds`,
and `edgeId` in that order, copy only present fields, and never materialize an
absent field as JSON null.

## Runtime capability gate

Until a runtime implements this contract, it MUST reject a graph containing a
`barrier` node whose config is an exact `IntegratedBarrierPolicy`, before any
dispatch, with the existing pre-flight capability mechanism and zero executor
calls, zero node attempts, and no durable side effect. Executing such a barrier
as an ordinary deterministic transform is a contract violation, because it would
silently pass an unsatisfied barrier.

This mirrors the accepted foreign-condition preflight and keeps the contract
honest while implementation proceeds.

## Conformance requirements

A conforming pair MUST consume the literal corpus and prove:

1. exact policy validation parity across every valid and invalid case,
   including JSON `1.0` acceptance, boolean rejection, unknown fields, explicit
   nulls, and kind/field cardinality;
2. exact compiler diagnostic projection, order, local suppression, and literal
   canonical graph hashes in both languages;
3. exact-integer satisfaction arithmetic for all four kinds, including the
   `MINIMUM_EXCEEDS_TOTAL` and `QUORUM_EXCEEDS_PARTICIPANTS` boundaries and the
   one-below, at, and one-above thresholds;
4. the complete disposition partition, count sums, and ID list ordering;
5. malformed-vote rejection as `INVALID_BARRIER_VOTE` with exactly one attempt
   and no disposition entry;
6. deterministic deadline arming and settlement against the scripted clock,
   including deciding before the deadline, at the exact deadline boundary, and
   after it, with correct `deadlineElapsed`;
7. every `onUnsatisfied` resolution, proving that no unsatisfied barrier ever
   binds an output or lets a descendant execute;
8. run terminal precedence across mixed `failed`, `unknown`, and
   `awaiting_human` barriers;
9. cancellation of an armed undecided barrier with no decision event;
10. both late-arrival policies, proving decision immutability under `ignore`
    and `BARRIER_LATE_ARRIVAL` under `reject`;
11. literal `policyHash` and `decisionId` values recomputed independently in
    each language, never imported from the other;
12. zero-rejudge replay with an executor call count of exactly zero, plus
    `DECISION_POLICY_DRIFT`, `DECISION_IDENTITY_MISMATCH`, and
    `DUPLICATE_DECISION` rejection; and
13. the existing core, primitives, patterns, scheduler, router, and durable
    suites remain green, and `evaluateSettledBarrier` behavior is unchanged.

Normal tests use deterministic executors and the scripted clock. Provider calls,
wall-clock timing, real concurrency races, and validation bypasses are outside
this tranche.
