# Portable budgets, durable settlement, pricing, and model routing

Status: D10 contract candidate, not accepted  
Contract family: `portable-budget/v1alpha1`  
Ledger family: `durable-budget-ledger/v1alpha1`  
Pricing family: `portable-pricing/v1alpha1`  
Router family: `model-router/v1alpha1`

This document defines the vendor-neutral budget and model-routing semantics for
Graph Engineering. It is normative for the adjacent schemas and conformance
oracle. It does not claim that either native runtime implements this contract
yet.

The contract becomes accepted only after:

1. an independent hostile contract review has no unresolved P0 or P1 finding;
2. the TypeScript and Python native ledgers pass the same fixtures;
3. storage-backed CAS, lease, crash, fork, and concurrency tests pass;
4. dispatch integration proves that a denied reservation performs no external
   work;
5. redaction, approval, and authority bindings survive the D9 gate; and
6. the D10 cross-language release control binds all evidence to one candidate.

Until those gates pass, these artifacts are a reviewable contract candidate.

## 1. Goals and non-goals

### 1.1 Goals

The contract provides:

- portable integer accounting with no floating-point admission decision;
- one closed identity for currency and every resource unit;
- atomic multi-dimensional root reservations;
- nested reservations for subgraphs, cycles, activities, tools, and models;
- durable usage settlement, release, dispute, and economic compensation;
- conservative treatment of ambiguous external usage;
- immutable pricing input;
- deterministic, policy-bound model selection;
- replay without a new route lookup or a second debit;
- checkpoint validation against the complete event prefix;
- event-stream CAS plus monotonic lease fencing;
- stable terminal-reason precedence;
- fail-closed behavior for unknown usage, price, authority, or classification;
- testable behavior for retry, cancellation, crash, fork, and fallback; and
- identical observable results in TypeScript and Python.

### 1.2 Non-goals

This contract does not:

- provide a mutable provider price service;
- convert currencies;
- promise exactly-once provider side effects;
- infer authority from a model response;
- make a provider usage report trustworthy merely because it is signed;
- restore scheduling capacity after an invoice credit or refund;
- define a vendor-specific tokenizer;
- permit a fallback to weaken privacy, approval, capability, or budget policy;
- use wall-clock readings as replay input;
- allow an unbounded provider-specific metric namespace; or
- make D10 complete without native and integration evidence.

## 2. Normative language and processing model

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be
interpreted as normative requirements.

A conforming implementation has four explicit layers:

1. **Shape validation.** Parse a closed JSON document and validate its schema.
2. **Semantic validation.** Enforce ordering, identity, conservation, policy,
   authority, and cross-document constraints.
3. **Durable transition.** Compare-and-swap one semantically preflighted event
   onto the expected history prefix.
4. **Dispatch or projection.** Dispatch only after durable admission, or
   rebuild state by folding already accepted history.

Shape validity never implies semantic validity. A re-signed document with a
valid hash but an invalid parent, price, scope, event order, or authority
binding MUST be rejected.

## 3. Canonical representation and portable arithmetic

### 3.1 JSON boundary

Every contract document is I-JSON-compatible UTF-8 JSON.

An input parser MUST reject:

- duplicate object keys;
- invalid UTF-8;
- non-finite numbers;
- fractional values in integer fields;
- integers outside the declared portable range;
- unknown object members;
- a non-canonical enum spelling;
- a trailing document after the first JSON value; and
- input beyond the configured canonical-byte limit.

Canonical JSON recursively sorts object keys by Unicode code point. Array order
is retained. No Unicode normalization is performed. Hashing consumes the UTF-8
bytes of that canonical JSON after the exact domain prefix.

### 3.2 Integer range

Portable counters are JSON safe integers:

`0 <= value <= 9,007,199,254,740,991`

Vector entries are positive integers. Zero is represented by absence, not by an
entry whose amount is zero. This creates one canonical zero representation and
prevents zero-entry ambiguity.

Implementations MUST use an intermediate representation wide enough to detect
overflow before converting to a portable integer. The reference oracle uses
`BigInt` for price multiplication and counter addition. Saturating,
wrapping, epsilon, or floating-point comparison is forbidden.

### 3.3 Money

`money-nano-minor` means one billionth of the declared currency's minor unit.

For a vector with:

- `currency = "USD"`; and
- `minorUnitExponent = 2`,

one minor unit is one cent and `1_000_000_000 money-nano-minor` is one cent.
The contract never assumes USD, never converts currencies, and never compares
vectors with different currency or minor-unit identities.

Currency and `minorUnitExponent` are part of every vector identity even when
the vector contains no money entry. This prevents an empty or partial vector
from being reused across incompatible accounts.

### 3.4 Hash domain register

Every identity in this contract is:

```text
SHA-256(UTF8(domain) || UTF8(canonical_json(framed_value)))
```

where `domain` always ends in a single NUL (`\0`) and `framed_value` is the
exact value named below. A second-language runtime that reproduces these
fourteen rows over thirteen domains reproduces every identity the conformance
oracle publishes; a row
that is not written down here cannot be reproduced from the specification, so
this register is normative and complete. The oracle asserts that each domain
string it uses appears in this document.

| Identity | Domain string | Framed value |
|---|---|---|
| Budget policy identity — `policyHash`, `PricingSnapshot.policyBindingHash`, `BudgetLedgerEvent.policyHash` | `graph-engineering/budget-policy/v1alpha1\0` | the complete resolved `BudgetPolicy`, with every ceiling materialized inline |
| Pricing snapshot identity — `pricingSnapshotHash`, `ModelRouterPolicy.pricingSnapshotHash` | `graph-engineering/pricing-snapshot/v1alpha1\0` | the complete `PricingSnapshot`, including its `policyBindingHash` |
| Router policy identity — `routerPolicyHash` | `graph-engineering/model-router-policy/v1alpha1\0` | the complete `ModelRouterPolicy` |
| Recorded health snapshot — `ModelRouteDecision.healthSnapshotHash` | `graph-engineering/model-health-snapshot/v1alpha1\0` | the recorded candidate-health object, one member per persisted candidate ID whose value is that candidate's recorded health state |
| Route decision identity — `ModelRouteDecision.decisionId` | `graph-engineering/model-route-decision/v1alpha1\0` | the complete decision **without** `decisionId` |
| Route decision content address — `RouteDecisionRecorded.decisionHash`, `ReservationCreated.routeDecisionHash`, checkpoint `routeDecisionHashes` | `graph-engineering/model-route-decision/v1alpha1\0` | the complete decision **including** its computed `decisionId` |
| Reservation binding — reservation projection `bindingHash` | `graph-engineering/budget-binding/v1alpha1\0` | the closed `ReservationCreated.data.binding` object |
| Reservation idempotency key — `ReservationCreated.data.idempotencyKey` | `graph-engineering/budget-reservation-request/v1alpha1\0` | `ReservationCreated.data` without `reservationId` and without `idempotencyKey` |
| Reservation final projection — `ReservationClosed.finalProjectionHash` | `graph-engineering/budget-reservation/v1alpha1\0` | the 6.3 reservation projection with its terminal `state` and its `closedSequence` set to the closing event's sequence |
| Account final projection — `BudgetAccountClosed.finalProjectionHash` | `graph-engineering/budget-projection/v1alpha1\0` | the account projection with `status = "closed"` and the terminal reason applied |
| Event payload — `BudgetLedgerEvent.payloadHash` | `graph-engineering/budget-event-payload/v1alpha1\0` | the event's closed `data` object |
| Event envelope — `BudgetLedgerEvent.eventHash` | `graph-engineering/budget-event/v1alpha1\0` | the complete event **without** `eventHash` |
| Event ID — `BudgetLedgerEvent.eventId`, prefixed with `e-` | `graph-engineering/budget-event-id/v1alpha1\0` | `{accountId, eventStreamId, sequence, type, payloadHash}` |
| Checkpoint content — `BudgetLedgerCheckpoint.contentHash` | `graph-engineering/budget-checkpoint/v1alpha1\0` | the complete checkpoint **without** `contentHash` |

The route-decision domain carries two framings. They can never collide: the
identity framing has no `decisionId` member and the content-address framing
always does, so no canonical byte string is a valid input to both.

## 4. Budget vector

The wire schema is
[`budget-vector.schema.json`](./budget-vector.schema.json).

A vector has:

- fixed contract identity;
- ISO-style three-letter uppercase currency;
- explicit minor-unit exponent;
- a closed portable quantity array; and
- a bounded provider-specific quantity array.

### 4.1 Portable resources

| Resource | Unit | Aggregation | Meaning |
|---|---|---|---|
| `artifact-bytes` | `byte` | `sum` | total stored artifact payload |
| `artifacts` | `count` | `sum` | total artifact objects |
| `attempts` | `count` | `sum` | admitted execution attempts |
| `audio-units` | `usage-unit` | `sum` | provider-declared audio units |
| `cached-input-units` | `usage-unit` | `sum` | provider-declared cached input |
| `candidates` | `count` | `sum` | cycle or verifier candidates |
| `concurrent-activities` | `count` | `maximum` | peak simultaneous activities |
| `depth` | `count` | `maximum` | maximum graph or recursion depth |
| `disk-bytes` | `byte` | `maximum` | peak governed disk footprint |
| `dynamic-nodes` | `count` | `sum` | accepted dynamic node additions |
| `elapsed-ms` | `millisecond` | `maximum` | elapsed orchestration bound |
| `fan-out` | `count` | `maximum` | maximum simultaneous fan-out |
| `graph-edges` | `count` | `maximum` | maximum compiled edge count |
| `graph-nodes` | `count` | `maximum` | maximum compiled node count |
| `image-units` | `usage-unit` | `sum` | provider-declared image units |
| `in-flight-bytes` | `byte` | `maximum` | peak unacknowledged transport |
| `input-units` | `usage-unit` | `sum` | model/provider input units |
| `memory-bytes` | `byte` | `maximum` | peak governed memory |
| `money-nano-minor` | `nano-minor` | `sum` | cost in declared currency |
| `node-dispatches` | `count` | `sum` | admitted node dispatches |
| `output-units` | `usage-unit` | `sum` | maximum or reported output |
| `provider-calls` | `count` | `sum` | external provider requests |
| `reasoning-units` | `usage-unit` | `sum` | provider-declared reasoning use |
| `tool-calls` | `count` | `sum` | admitted tool executions |
| `transport-bytes` | `byte` | `sum` | transferred governed bytes |

The unit and aggregation in the table are exact. A document cannot reinterpret
`attempts` as bytes, money as a decimal, or elapsed time as an additive debit.

### 4.2 Ordering and uniqueness

Portable entries MUST be ordered by `resource` using Unicode code-point order.
Each resource occurs at most once.

Provider entries MUST be ordered by:

`metricId + U+0000 + unitId`

The pair occurs at most once. Ordering is semantic, not cosmetic: two runtimes
must serialize and hash the same vector identically.

### 4.3 Provider-specific metrics

A provider metric has:

- a versioned `metricId`;
- a versioned `unitId`;
- `sum` or `maximum` aggregation; and
- a positive portable amount.

Every metric MUST be present in the active policy's
`allowedProviderMetrics`. Unknown metrics fail with
`GE_BUDGET_UNKNOWN_USAGE`; they are not silently dropped or placed into a
generic bucket.

Adding a new provider metric changes the policy identity. Experimental carbon
or sustainability metrics belong here and cannot become release-critical
truth without an accepted unit and measurement contract.

### 4.4 Aggregation

`sum` resources are conserved debits. Combining independent use adds them.

`maximum` resources are monotonic gates. Combining observations takes the
larger value. They do not become spendable credit and are never arithmetically
subtracted.

Durable reservation vectors contain only `sum` entries. Maximum resources are
checked as sound pre-dispatch gates against the active scope ceiling. This
separation prevents nonsensical operations such as releasing elapsed time or
splitting recursion depth as currency.

### 4.5 Compatibility

Vector arithmetic requires exact equality of:

- API version;
- kind;
- contract version;
- currency;
- minor-unit exponent;
- resource unit;
- provider unit identity; and
- aggregation.

An absent dimension is zero. A left-side amount is less than or equal to a
ceiling only if the ceiling contains the same dimension and at least that
amount.

## 5. Budget policy

The wire schema is
[`budget-policy.schema.json`](./budget-policy.schema.json).

### 5.1 Root and scope ceilings

The root ceiling is the maximum authority-bound budget for one account. Scope
ceilings may narrow the root for:

- tenant;
- run;
- graph;
- node;
- activity;
- provider; or
- model.

Scope keys are unique and ordered by:

`scopeKind + U+0000 + scopeId`

Every scope vector MUST be component-wise less than or equal to the root
ceiling. A scope cannot introduce a dimension absent at the root.

Effective admission is the component-wise intersection of every applicable
scope. Inheritance is narrowing only. Missing scope metadata does not grant the
widest scope; policy resolution must explicitly choose the applicable set
before an admission event is created.

A scope is *applicable* to a candidate reservation when the reservation binding
of 6.2 carries the scope identity at the fixed coordinate for that scope kind:

| `scopeKind` | reservation binding coordinate |
|---|---|
| `tenant` | `tenantId` |
| `run` | `runId` |
| `graph` | `graphHash` |
| `node` | `nodeId` |
| `activity` | `activityId` |
| `provider` | `providerId` |
| `model` | `modelId` |

A null coordinate — a reservation with no provider or no model — matches no
scope of that kind. It never matches every scope of that kind. Because a model
or tool subject may contain `/` and `:`, `scopeId` uses the subject identifier
grammar rather than the plain identifier grammar; a policy whose model scope
cannot name its model is a policy whose model ceiling can never bind.

Each applicable scope carries a running demand total. A reservation adds its
declared maximum to the demand of scope `S` if and only if `S` is applicable to
that reservation and `S` is **not** applicable to its parent reservation. A
child allocation is carved out of the parent maximum that already charged the
shared scope, so charging both would double count rather than intersect; the
topmost reservation on each chain is the one that charges.

Admission requires, for every charged scope, that the resulting demand remain
component-wise less than or equal to that scope ceiling. Failure is
`GE_BUDGET_ADMISSION_DENIED` and is atomic with the rest of 5.2: no dimension
and no scope is debited when any check fails.

Scope demand is a fold-derived quantity. It is recomputed from the event
history, not restored from a checkpoint, because a checkpoint retains only each
reservation's `bindingHash` and not its binding coordinates. A native runtime
that resumes from a checkpoint MUST therefore replay the referenced prefix
before admitting further reservations.

### 5.2 Inclusive admission

The fixed v1alpha1 rule is:

`inclusive-ceiling-admit-only-if-worst-case-fits`

A request equal to the remaining ceiling is admissible. A request one integer
unit above any dimension is denied atomically.

Admission MUST evaluate the complete worst-case vector before dispatch. It
MUST NOT reserve the dimensions that fit and leave the others unreserved.

Conceptually:

```text
effective = intersect(root, tenant, run, graph, node, provider, model)
candidate = sound_worst_case(request)

if unknown_usage_or_price_or_authority(candidate):
    deny
if any(candidate[dimension] > effective_remaining[dimension]):
    deny
else:
    CAS(reserve_all_dimensions(candidate))
```

Only the successful CAS authorizes dispatch.

### 5.3 Unknown and overage behavior

The fixed behaviors are:

- unknown usage: deny before dispatch;
- unknown pricing: deny unless a conservative explicit money reservation
  exists;
- provider overage:
  `deny-report-above-declared-ceiling-retain-envelope-stop-new-work`; and
- in-doubt use: retain the maximum unresolved amount.

A provider report above a reservation is not allowed to create new credit or
silently enlarge the reservation. In v1alpha1 such a report is **rejected** at
the ledger boundary with `GE_BUDGET_USAGE_OVERAGE`. The event is not appended,
the trusted report envelope is retained by hash outside the ledger, and the
rejection is the stop signal for new work on that reservation.

An earlier draft of this section required the runtime to "commit at most the
declared ceiling, dispute the excess". That behavior is not representable in
the v1alpha1 ledger algebra and the requirement is withdrawn rather than
weakened:

- 6.3 requires `committed + released + remaining + childAllocated = maximum`,
  so committed use can never exceed the reservation maximum; and
- 6.1 requires `disputed` to remain a subset of committed use.

Excess above the maximum is therefore neither committable nor disputable. A
representation for it would have to break one of those two invariants, which is
a larger change than a settlement path is allowed to make. `UsageCommitted`
consequently accepts only `overageDisposition: "none"`; the reserved wire value
`declared-ceiling-committed-excess-disputed` is refused with
`GE_BUDGET_USAGE_OVERAGE` so that it cannot be mistaken for an accepted
disposition, and it remains reserved for a v1alpha2 contract that introduces an
explicit excess carrier alongside revised conservation rules.

The supported way to settle more than a reservation currently holds is to
enlarge authority before the report: obtain a new authorized allocation, or a
second reservation, and settle against that. Authority always precedes spend.

### 5.4 Bounds

The policy bounds:

- reservation count;
- reservation nesting depth;
- provider metric count;
- event count; and
- canonical bytes.

Native implementations MAY impose narrower deployment limits. They MUST
surface the narrower limit before admission and MUST NOT accept a document
that another layer will later truncate.

## 6. Durable budget ledger

The event schema is
[`budget-ledger-event.schema.json`](./budget-ledger-event.schema.json).
The checkpoint schema is
[`budget-ledger-checkpoint.schema.json`](./budget-ledger-checkpoint.schema.json).

### 6.1 Account totals

An account projection contains:

- `ceiling`: immutable root ceiling;
- `available`: unreserved scheduling capacity;
- `rootReserved`: admitted but not yet committed or root-released capacity;
- `committed`: settled or conservatively in-doubt usage;
- `releasedAudit`: release-event audit total;
- `disputed`: usage under dispute; and
- `compensatedEconomic`: invoice/refund adjustment with no scheduling credit.

For every additive dimension:

`available + rootReserved + committed = ceiling`

`releasedAudit` is not part of this equation. It is an event audit total and
may include both a child-to-parent release and the later root-to-account
release of the same capacity.

`disputed` remains included in committed use. `compensatedEconomic` never
reduces committed use or increases available capacity.

### 6.2 Reservation identity

Every reservation binds:

- tenant;
- run;
- graph hash and revision;
- node;
- attempt;
- activity;
- cycle round;
- plan hash;
- provider; and
- model.

Nullable fields remain explicit. The binding is closed and content-addressed.
A re-signed event that changes any binding coordinate is a different
reservation claim and cannot reuse the old idempotency identity.

### 6.3 Reservation projection

Each reservation retains:

- immutable maximum;
- committed use;
- explicit releases;
- remaining capacity;
- live child allocation;
- in-doubt committed use;
- disputed use;
- economic compensation;
- lifecycle state;
- creation sequence; and
- close sequence.

For every additive dimension:

`committed + released + remaining + childAllocated = maximum`

In-doubt usage MUST be less than or equal to committed usage.
Economic compensation MUST be less than or equal to disputed usage.

### 6.4 Root reservation

A root reservation has:

- no parent;
- depth zero;
- a maximum less than or equal to account `available`; and
- an atomic debit from `available` into `rootReserved`.

Usage moves capacity from `rootReserved` into `committed`.
A root release moves capacity from `rootReserved` back into `available`.
A root can close only after all capacity is committed or released and every
child is closed.

### 6.5 Child reservation

A child reservation:

- references an existing open parent;
- has depth exactly `parent.depth + 1`;
- stays within the policy nesting limit;
- is component-wise contained by parent `remaining`; and
- atomically moves its maximum from parent `remaining` to
  `parent.childAllocated`.

Closing a child:

1. requires no live descendants;
2. requires zero child remaining capacity;
3. removes the child maximum from `parent.childAllocated`;
4. propagates child committed use to parent committed use;
5. returns child released capacity to parent remaining;
6. propagates in-doubt, dispute, and compensation audit state; and
7. does not debit global committed use a second time.

This creates nested conservation without double charging.

### 6.6 Ledger events

| Event | Required transition |
|---|---|
| `BudgetAccountOpened` | bind policy, price, router, root scope, and ceiling |
| `ReservationCreated` | atomically reserve root or parent capacity |
| `RouteDecisionRecorded` | persist a content-addressed selected/denied route |
| `UsageCommitted` | settle trusted or conservative use once |
| `ReservationReleased` | release unused capacity at the current nesting level |
| `UsageDisputed` | retain contested committed use and stop unsafe continuation |
| `UsageCompensated` | record economic correction without capacity restoration |
| `ReservationClosed` | freeze the final reservation projection |
| `BudgetAccountClosed` | freeze terminal account projection and reason |

Events use a closed type-specific `data` object. Unknown envelope or payload
fields are rejected even when all hashes are recomputed.

### 6.7 Hash chain

Sequence zero has:

- `expectedPreviousSequence = -1`; and
- `previousEventHash = null`.

Every later event has:

- sequence exactly prior sequence plus one;
- expected previous sequence equal to the prior sequence; and
- previous event hash equal to the accepted prior event hash.

The event ID is deterministic:

```text
"e-" + SHA-256(
  UTF8("graph-engineering/budget-event-id/v1alpha1\0") ||
  canonical_json({
    accountId,
    eventStreamId,
    sequence,
    type,
    payloadHash
  })
)
```

It cannot be reused at another sequence or for another payload.

Payload hash:

```text
SHA-256(
  UTF8("graph-engineering/budget-event-payload/v1alpha1\0") ||
  canonical_json(data)
)
```

Event hash:

```text
SHA-256(
  UTF8("graph-engineering/budget-event/v1alpha1\0") ||
  canonical_json(event_without_eventHash)
)
```

The event hash includes `payloadHash`. Recomputing both hashes does not make a
semantically invalid event acceptable.

### 6.8 CAS and fencing

A writer MUST preflight the full candidate event through the semantic fold
before persistence. It then performs one append CAS against:

- account ID;
- event stream ID;
- expected prior sequence;
- expected prior event hash;
- lease epoch; and
- fencing token.

A stale token, lower epoch, conflicting holder at the same epoch/token, expired
lease, sequence mismatch, or prefix mismatch fails without a write.

An invalid event MUST NOT be appended and discovered only on later replay. A
poisoned durable stream is a P0 defect.

### 6.9 Idempotency

Settlement, release, dispute, and compensation identities map to one canonical
payload outcome.

The reservation idempotency key is:

```text
SHA-256(
  UTF8("graph-engineering/budget-reservation-request/v1alpha1\0") ||
  canonical_json(ReservationCreated.data without reservationId and
                 idempotencyKey)
)
```

The checkpoint retains the key, accepted reservation ID, and canonical
reservation payload hash. Changing a reservation ID while reusing the key is a
conflict; losing this map during checkpoint recovery is corruption.

- An exact duplicate may be treated as an idempotent no-op.
- The same identity with different data is
  `GE_BUDGET_IDEMPOTENCY_CONFLICT`.
- A retry cannot obtain a new reservation merely by changing a transport
  request ID.
- A recorded route decision cannot be rebound to another reservation.

### 6.10 External side effects and crash windows

External providers are at-least-once unless their own protocol offers a
stronger idempotency guarantee.

The required order is:

1. compute the sound worst case;
2. durably reserve;
3. dispatch with reservation and idempotency identity;
4. retain the provider request identity;
5. durably settle, dispute, or mark in doubt; and
6. release only capacity proven unused.

Crash before reservation means no authorized dispatch.
Crash after reservation but before dispatch leaves a releasable reservation.
Crash after dispatch but before a trusted response leaves conservative
in-doubt committed usage. Recovery MUST NOT assume the provider did nothing.

Timeout, cancellation, or local failure does not prove zero external usage.
Non-idempotent work remains in doubt until trusted reconciliation or operator
disposition.

### 6.11 Checkpoint and replay

A checkpoint is a cache of one complete event prefix, never a second source of
truth. It binds:

- account and stream;
- sequence and history prefix hash;
- policy, pricing, and authority;
- terminal state;
- all totals;
- every reservation;
- every reservation idempotency key, reservation ID, and canonical payload
  outcome;
- all idempotency ID sets; and
- all route decision hashes.

Checkpoint content hash uses:

```text
"graph-engineering/budget-checkpoint/v1alpha1\0"
```

and the canonical checkpoint without `contentHash`.

Acceptance requires both:

1. valid shape and content hash; and
2. exact equality with a full fold of the referenced history prefix.

A re-signed checkpoint with one available unit added is corrupt.

Replay is read-only:

- no fresh price query;
- no live health query;
- no model rediscovery;
- no new reservation;
- no provider dispatch; and
- no second debit.

### 6.12 Fork

A fork creates a new account or an explicit newly authorized allocation.
It cannot copy:

- source account ID;
- source event stream ID;
- source available credit;
- source lease/fence;
- a consumed reservation; or
- an idempotency outcome as spendable capacity.

Historical events and route decisions MAY be referenced as immutable evidence.
Scheduling credit must come from a new policy-authorized account transition.

## 7. Pricing snapshot

The wire schema is
[`pricing-snapshot.schema.json`](./pricing-snapshot.schema.json).

### 7.1 Immutability and identity

A snapshot binds:

- snapshot ID;
- currency and minor-unit exponent;
- effective interval;
- source kind and locator hash;
- retrieval time;
- source content hash;
- signature disposition;
- budget policy identity;
- rounding rule; and
- every provider/account/region/subject price entry.

Refresh is outside an active run. A changed price produces a new snapshot and
hash. History is never rewritten.

### 7.2 Price entry

An entry identifies:

- provider;
- account class;
- region;
- model or tool;
- subject identity; and
- a closed set of meter/usage-class rules.

Entry IDs are unique and ordered. Subject tuples are unique. Rules are unique
and ordered by:

`meter + U+0000 + usageClass`

### 7.3 Rounding

The v1alpha1 rule is:

`ceil-each-request-meter-before-sum`

For each meter:

```text
billableBlocks = ceil(usage / unitQuantity)
meterCost = billableBlocks * priceNanoMinor
requestCost = sum(meterCost)
```

Each multiplication and sum is overflow-checked. Implementations MUST NOT
aggregate usage across requests before applying this rule unless a future
snapshot contract explicitly says so.

### 7.4 Missing price

If a required meter, account, region, subject, or snapshot identity is absent,
money-bounded work is denied with `GE_ROUTE_PRICING_UNAVAILABLE` unless the
active policy explicitly supplies a conservative reservation independent of
that missing price. The current router contract does not model that exception,
so it denies.

### 7.5 Public cost states

User-facing cost output MUST distinguish:

- estimated;
- reserved;
- provider-reported;
- reconciled;
- disputed;
- economically compensated; and
- unknown.

These labels cannot be collapsed into one misleading “cost” number.

## 8. Deterministic model router

The policy schema is
[`model-router-policy.schema.json`](./model-router-policy.schema.json).
The persisted decision schema is
[`model-route-decision.schema.json`](./model-route-decision.schema.json).

### 8.1 Inputs

Routing consumes only persisted inputs:

- resolved router policy;
- immutable pricing snapshot;
- authority binding;
- classification hash and data class;
- capability requirements;
- allowed regions;
- minimum quality;
- input/output/context/duration/money maxima;
- approval binding; and
- recorded candidate health snapshot.

Session and default inheritance MUST be resolved before the router policy is
persisted. Live ambient defaults are not routing inputs.

### 8.2 Candidate contract

Each candidate declares:

- candidate, provider, model, and account identity;
- region;
- quality tier;
- fallback rank;
- capabilities;
- allowed data classes;
- price entry;
- input, output, context, and duration limits;
- approval requirement; and
- authority grant hash.

Candidate IDs are unique and ordered. Capability and data-class arrays are
unique and ordered. The candidate price entry must exactly match its provider,
account, region, and model.

The candidate's maximum input plus maximum output cannot exceed its declared
context. Every candidate grant MUST occur in the router policy's explicit,
sorted `allowedAuthorityGrantHashes`. The policy's `authorityBindingHash`
binds that allowlist to the external authority contract; D9 integration MUST
resolve and verify the referenced grant documents before dispatch.

### 8.3 Eligibility

Every candidate is evaluated independently against:

1. authority;
2. required capabilities;
3. data-class privacy;
4. region;
5. minimum quality;
6. input/output/context bounds;
7. duration;
8. approval;
9. pricing;
10. money bound; and
11. recorded health.

Reasons are persisted in code-point order. The v1alpha1 health gate admits
only `ready`. `open`, `half-open`, `rate-limited`, `unknown`, and `closed` do
not dispatch through this route. A future half-open probe requires a distinct
bounded contract and cannot be inferred.

### 8.4 Selection

Eligible candidates are ordered by:

1. quality descending: `judge`, `premium`, `standard`, `economy`;
2. fallback rank ascending; and
3. candidate ID in Unicode code-point order.

The first candidate is selected.

Fallback is a traversal of already eligible candidates. It never removes a
reason or bypasses authority, privacy, approval, capability, region, price,
money, duration, context, or health.

### 8.5 Denial

When no candidate is eligible, the router chooses the candidate with the
fewest rejection reasons, then candidate ID. The stable reason-to-code
precedence is:

1. authority → `GE_ROUTE_AUTHORITY_DENIED`;
2. privacy → `GE_ROUTE_PRIVACY_DENIED`;
3. approval → `GE_ROUTE_APPROVAL_REQUIRED`;
4. capability or quality → `GE_ROUTE_CAPABILITY_UNAVAILABLE`;
5. region → `GE_ROUTE_REGION_DENIED`;
6. context or duration → `GE_ROUTE_CAPABILITY_UNAVAILABLE`;
7. pricing → `GE_ROUTE_PRICING_UNAVAILABLE`;
8. money → `GE_ROUTE_BUDGET_DENIED`;
9. health → `GE_ROUTE_HEALTH_UNAVAILABLE`; and
10. no classified reason → `GE_ROUTE_NO_CANDIDATE`.

This makes denial reproducible without hiding a viable-nearest candidate
behind failures from unrelated candidates.

### 8.6 Persisted decision

A decision retains:

- request/run/node/attempt identity;
- router, price, authority, classification, and health hashes;
- exact requirements;
- evaluation of every candidate;
- selected candidate or denial;
- reservation identity for a selection;
- `decisionOrigin = "new-decision"`; and
- decision time.

Selected, denial, and reservation fields are mutually constrained:

- selected outcome has a selection, no denial code, and a reservation ID;
- denied outcome has no selection, a denial code, and no reservation ID.

The decision identity is content-addressed. A reservation referencing a route
must first observe the exact decision hash in the ledger.

A reservation that carries a `routeDecisionHash` MUST also *cover* that
decision's own sound worst case. Its declared maximum MUST be component-wise
greater than or equal to:

| Dimension | Lower bound from the decision |
|---|---|
| `input-units` | `requirements.inputUnits` |
| `output-units` | `requirements.maximumOutputUnits` |
| `money-nano-minor` | `selected.estimatedMoneyNanoMinor` |
| `provider-calls` | `1` |

Otherwise the admission gate is decorative: the ledger would authorize a
provider call whose recorded worst case exceeds the capacity anybody holds, and
the resulting report would be forced through the 5.3 overage path. Failure is
`GE_BUDGET_ADMISSION_DENIED`.

### 8.7 Replay

Replay reuses the exact recorded decision bytes. A runtime invocation envelope
may report that it reused a decision, but it MUST NOT mutate the persisted
decision, its `decisionOrigin`, its content identity, or its ledger hash.

Replay does not:

- refresh pricing;
- query live health;
- reorder candidates;
- reclassify data;
- select a newer model;
- create a reservation; or
- call the provider.

If required bound inputs are unavailable, replay fails instead of silently
rerouting.

### 8.8 Model authority

Model output is data, never router authority. A model cannot:

- add itself to the candidate list;
- change its grant;
- relax classification;
- provide its own approval;
- raise a money limit;
- mark its circuit ready;
- replace the pricing hash; or
- force fallback.

Dynamic graph planning may request capabilities and a quality floor. Policy
and durable admission retain the final decision.

## 9. Terminal reason precedence

When multiple facts become true at one deterministic transition, the first
present reason in this fixed list wins:

1. `CANCELLED`
2. `MAX_DURATION`
3. `MAX_MONEY`
4. `MAX_PROVIDER_USAGE`
5. `MAX_ATTEMPTS`
6. `MAX_DYNAMIC_NODES`
7. `MAX_GRAPH_SIZE`
8. `MAX_FAN_OUT`
9. `MAX_DEPTH`
10. `MAX_BYTES`
11. `DISPUTED_USAGE`
12. `FAILED`

`COMPLETED` is used only when no limiting or failure fact applies.

The recorded winner is replayed. Replay does not compare current clock or
provider state.

## 10. Stable failures

Important stable codes include:

| Code | Meaning |
|---|---|
| `GE_BUDGET_VECTOR_INVALID` | vector fails closed shape or numeric range |
| `GE_BUDGET_VECTOR_ORDER` | vector entries are not canonical |
| `GE_BUDGET_VECTOR_DUPLICATE` | resource or provider key repeats |
| `GE_BUDGET_VECTOR_UNIT` | fixed unit or aggregation changed |
| `GE_BUDGET_CURRENCY_MISMATCH` | currency identity differs |
| `GE_BUDGET_UNKNOWN_USAGE` | metric is not policy allowlisted |
| `GE_BUDGET_SCOPE_EXPANSION` | child scope exceeds root |
| `GE_BUDGET_ADMISSION_DENIED` | atomic worst case does not fit |
| `GE_BUDGET_PARENT_MISSING` | nested reservation parent is absent/closed |
| `GE_BUDGET_CHILD_EXPANSION` | child exceeds parent or depth |
| `GE_BUDGET_USAGE_OVERAGE` | usage exceeds declared reservation |
| `GE_BUDGET_IDEMPOTENCY_CONFLICT` | one ID maps to different outcomes |
| `GE_BUDGET_LEASE_CONFLICT` | lease or fence is stale/invalid |
| `GE_BUDGET_INVALID_HISTORY` | sequence, hash, binding, or terminal history is invalid |
| `GE_BUDGET_CORRUPT_CHECKPOINT` | checkpoint differs from history fold |
| `GE_BUDGET_COMPENSATION_INVALID` | compensation tries to create credit |
| `GE_BUDGET_FORK_CREDIT_REUSE` | fork copies spendable source credit |
| `GE_BUDGET_COUNTER_OVERFLOW` | integer operation exceeds portable range |
| `GE_ROUTE_AUTHORITY_DENIED` | route authority does not cover candidate |
| `GE_ROUTE_PRIVACY_DENIED` | data class is not allowed |
| `GE_ROUTE_APPROVAL_REQUIRED` | required approval is absent |
| `GE_ROUTE_CAPABILITY_UNAVAILABLE` | no candidate meets functional bounds |
| `GE_ROUTE_REGION_DENIED` | no candidate is in an allowed region |
| `GE_ROUTE_PRICING_UNAVAILABLE` | immutable applicable price is absent |
| `GE_ROUTE_BUDGET_DENIED` | worst-case price exceeds request bound |
| `GE_ROUTE_HEALTH_UNAVAILABLE` | recorded health blocks dispatch |
| `GE_ROUTE_DECISION_INVALID` | persisted decision cannot authorize reservation |

Implementations MAY attach safe details. They MUST retain the stable code and
MUST NOT place secrets, prompts, credentials, or unredacted provider payloads
in errors.

## 11. Conformance fixture

The executable fixture is
[`conformance/budget.case.json`](./conformance/budget.case.json).
The oracle is
[`conformance/budget.validate.mjs`](./conformance/budget.validate.mjs).

The current candidate exercises:

- seven Draft 2020-12 schemas;
- eight vector projections;
- a root ceiling narrowed by tenant, run, provider, and model scopes;
- immutable two-model mock pricing;
- four route outcomes;
- ten durable nested-ledger events;
- complete hash-chain replay;
- terminal checkpoint validation;
- fifty-four semantic negative cases;
- six multi-fact terminal precedence cases; and
- seven re-signed unknown-field attacks.

The corpus, the attack registry inside the oracle, and the count published
above are asserted to be the same set on every run, and every declared negative
is observed to execute. Deleting cases from the corpus fails the gate instead
of shrinking it silently.

### 11.1 Positive route cases

The fixture proves:

- confidential tool use selects the premium mock candidate at a money ceiling
  exactly equal to the sound estimate — `600000000` against an estimate of
  `600000000`, the inclusive bound of 5.2;
- secret data is denied by privacy;
- open circuits are denied before dispatch; and
- a money ceiling exactly one nano-minor unit below the same sound estimate —
  `599999999` against `600000000` — is denied with `GE_ROUTE_BUDGET_DENIED`.

The last two cases share every other requirement, so together they pin the
inclusive/exclusive boundary at one integer unit rather than at an arbitrary
distance.

Mock pricing is deterministic. Normal CI does not require credentials, network
access, a provider account, or current public prices.

### 11.2 Nested ledger scenario

The positive ledger:

1. opens an account;
2. reserves a root cycle-round allocation;
3. records a selected model route;
4. creates the route-bound child reservation;
5. commits provider usage;
6. releases child remainder;
7. closes the child and propagates accounting;
8. releases root remainder;
9. closes the root; and
10. closes the account as completed.

The checkpoint is validated against a second full replay.

### 11.3 Semantic attacks

The negative corpus covers:

- vector order, unit, duplicate, negative, and overflow;
- currency mismatch and scope expansion;
- price order, interval, and identity drift;
- route authority drift;
- child before parent and child over-allocation;
- usage over reservation;
- duplicate settlement conflict;
- release over remaining;
- closing a parent with a live child;
- stale fencing;
- a fully re-hashed account-binding drift;
- an event after terminal closure;
- a fully re-hashed checkpoint credit substitution;
- compensation credit escape;
- unknown provider metric; and
- fork credit reuse;
- reservation idempotency-key drift and conflict;
- root-scope binding drift;
- already-expired admission;
- duplicate reservation close;
- lease takeover without a larger fence;
- a maximum gate one unit over;
- an authority grant outside the allowlist;
- selected-grant substitution;
- price multiplication overflow;
- an impossible calendar date;
- checkpoint loss of reservation outcomes;
- a pricing snapshot bound to another policy;
- a route decision whose recorded health snapshot identity does not match the
  health it evaluated;
- a reservation one nano-minor unit over its applicable model scope ceiling;
- two sibling root reservations whose cumulative demand exceeds the tenant
  scope ceiling while account `available` still permits both;
- a route-bound reservation that does not cover its own recorded estimate;
- a settlement carrying the unrepresentable overage disposition of 5.3;
- four restored projections that break a 6.1 or 6.3 invariant — reservation
  conservation, in-doubt over committed, compensation over disputed, and
  account-level conservation;
- a route-bound reservation whose binding names another model;
- a provider-bound reservation with no persisted route decision;
- a second route decision rebound to a reservation that already has one; and
- the four 5.4 deployment bounds — reservation depth, reservation count, event
  count, and policy canonical bytes — plus the provider-metric count bound.

Each attack asserts one stable code. Merely throwing is not sufficient. Where
two rules share one stable code, the case also asserts the substring of the
message that identifies which rule fired.

### 11.4 Required native extensions

Before D10 native acceptance, both runtimes must add:

- exact-bound and one-over tests for every portable dimension;
- concurrent root reservation races with one CAS winner;
- lease takeover and stale-writer rejection;
- crash at every reserve/dispatch/settle/release boundary;
- non-idempotent external in-doubt recovery;
- provider report over declared ceiling;
- trusted envelope and redaction binding;
- cancellation and timeout settlement;
- nested subgraph plus cycle allocation;
- patch/fallback attempts to escape scope;
- checkpoint substitution at every projection field;
- fork with new authorized credit and rejected copied credit;
- pricing change between runs and immutable old replay;
- currency mismatch;
- live health changes ignored during replay;
- denied route proving zero provider calls; and
- byte-for-byte TypeScript/Python reporter parity.

## 12. Security and privacy requirements

Budget metadata can reveal tenant behavior and model selection. It is governed
metadata, not public telemetry.

Implementations MUST:

- bind tenant, authority, classification, and policy;
- keep capture and product telemetry off by default;
- exclude prompt/response/provider payloads from ledger events;
- store only the trusted usage-envelope hash in the portable event;
- apply D9 sink redaction before logs, traces, support bundles, or exports;
- reject prototype keys and parser ambiguity at language boundaries;
- bound canonical bytes and collection sizes before expensive processing;
- authenticate storage writers;
- authorize checkpoint and history reads by tenant;
- prevent one tenant from discovering another tenant's candidate/account data;
- avoid leaking credentials in price source metadata;
- treat provider identifiers as data, not executable configuration; and
- retain immutable audit evidence for disputes and compensation.

## 13. Implementation boundary and delivery status

### 13.1 D10 contract task

`D10-BUDGET-SPEC-035` owns:

- integer unit semantics;
- policy and scope ceilings;
- pricing snapshot identity;
- route policy and decision;
- ledger event and checkpoint carriers;
- deterministic reference fold; and
- conformance fixtures.

The task remains in progress until independent review is accepted.

### 13.2 Native tasks

Native ledger and router work is intentionally separate:

- TypeScript native implementation;
- Python native implementation;
- storage/CAS/fence adapters;
- runtime dispatch integration; and
- cross-language conformance join.

The contract oracle is not a production storage engine and does not authorize
external dispatch.

### 13.3 Prerequisites

Production integration depends on:

- accepted D7 cycle semantics;
- accepted D9 extended durability, redaction, approval, and authority
  primitives;
- integrated router/barrier behavior;
- scheduler no-dispatch gates; and
- storage-ready lease/CAS interfaces.

Contract-first development may proceed while those lanes are open. Release
acceptance may not.

## 14. Versioning

The v1alpha1 family is closed. A change to any of these requires a new contract
version or an explicitly accepted compatibility rule:

- resource unit or aggregation;
- integer range;
- money scale;
- ordering;
- hash domain;
- admission inclusivity;
- reservation conservation;
- compensation effect;
- terminal precedence;
- pricing rounding;
- quality ordering;
- denial precedence;
- health eligibility; or
- replay behavior.

Unknown versions fail closed. An implementation cannot advertise support for a
newer version merely because its JSON shape happens to validate.

## 15. Review checklist

An independent reviewer should attempt to prove:

- a re-signed unknown event field is accepted;
- an invalid event can be persisted before semantic fold;
- one failed dimension leaves partial reservation state;
- maximum resources can be released as credit;
- child accounting can exceed its parent;
- nested settlement is charged twice or not charged;
- compensation increases available capacity;
- duplicate settlement changes the outcome;
- a stale writer wins after lease takeover;
- a checkpoint can mint one unit of credit;
- a fork can copy source credit;
- integer arithmetic wraps;
- a currency mismatch is compared numerically;
- a stale price is used silently;
- fallback bypasses privacy or approval;
- an unhealthy route dispatches;
- replay queries live provider state;
- a model can influence its own authority; or
- a denied reservation reaches an executor.

Any successful attack is at least P1. Persistence of invalid history, budget
escape, cross-tenant authority expansion, or unauthorized external dispatch is
P0.
