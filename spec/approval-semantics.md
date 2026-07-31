# Approval authority, idempotency, and binding semantics v1alpha1

Status: **contract candidate**. `implementationClaim: false`. No TypeScript or
Python runtime implements this contract. Freezing this file grants no approval,
human-gate, resumption, capability, or authority-transfer capability claim.
Nothing in this repository can currently issue, present, validate, or honour an
approval; a run that reaches a human gate today stops and stays stopped.

The normative corpus is [conformance/approval.case.json](conformance/approval.case.json).
Its executable oracle is
[conformance/approval.validate.mjs](conformance/approval.validate.mjs).

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative.

## 1. Scope and authority

Section 15.6 of the master plan requires that human approval be "a signed/bound
state transition, not a free-form boolean", and enumerates the request identity,
the five decisions, idempotent repeated delivery, stale rejection, requester and
approver separation, durable projection, replay without contacting a human, fork
transfer, and surfaces that cannot broaden the authorized operation. Section
11.3 requires human escalation for routers and barriers and requires that
insufficient evidence never become an implicit pass. The plan body's *Durable
execution* section requires that "resuming a non-idempotent node requires
confirmation". This document freezes exactly that.

This document defines:

- the closed `ApprovalAuthority` policy, its principal allowlist, its scope
  ceiling, and its unanswered-request behaviour;
- the closed `ApprovalRequest` document and the frozen `HumanInputRequested`
  event payload that carries it;
- the closed `ApprovalGrant` document and the frozen `HumanInputReceived` event
  payload that carries it;
- five domain-separated hash constructions with explicit byte lengths;
- the member-wise scope subset relation and the non-expansion rule;
- the presentation pipeline: an ordered list of 34 guards over 30 stable error
  codes producing exactly one of three outcomes;
- the idempotency rule that makes a duplicate presentation a zero-write replay;
- staleness as a family of distinct codes that is never conflated with forgery;
- fork behaviour, in which a parent's grant is a mismatch rather than reuse; and
- the discharge protocol by which a granted approval resumes a barrier that
  [integrated-barrier-semantics.md](integrated-barrier-semantics.md) settled as
  `awaiting_human`.

This document does **not** define approver user interfaces, notification
transport, signature or PKI algorithms, multi-approver quorum, delegation,
approval budgets, or any storage layout. It defines no runtime behaviour beyond
the pipeline below, and it does not modify any frozen contract.

### 1.1 Relationship to the integrated barrier contract

`integrated-barrier-semantics.md` freezes, for `onUnsatisfied: "human"`:

> `human` — the barrier node settles with the terminal status `awaiting_human`.
> The scheduler emits `HumanInputRequested` carrying the decision document,
> schedules no descendant, and stops. Whether and how such a run resumes is
> `D9-APPROVAL-077` authority and is not specified here. A `human` resolution
> MUST NOT be reported as satisfied, succeeded, failed, or cancelled.

and, in its scope section:

> A `human` resolution suspends the run and stops; the authority that may later
> resume it is `D9-APPROVAL-077` work and is an explicit non-claim here.

Section 9 below supplies exactly that authority and nothing more. It does not
weaken any of the four prohibitions in the quoted paragraph: after a discharge
the barrier is still not satisfied, still not succeeded, still not failed, still
not cancelled, and it still binds no output. Section 9.4 states the one place
where this contract makes a normative decision the barrier contract left open,
and states it as a decision rather than as an inference.

### 1.2 Relationship to the redaction contract

`redaction-semantics.md` §4.4 freezes policy non-expansion for capture policy:

> A graph, node, router, planner, verifier, provider, tool, resumed worker,
> dynamic patch, or child graph may request less observational capture. It
> cannot […]

and §8.4 freezes, for replay and fork:

> refs, value MACs, activity keys, ciphertext, or approvals are never copied as
> authority across runs

Section 6 of this document is the same rule applied to authority instead of
capture, and Section 8 is the same fork prohibition applied to grants. Master
plan §15.7 states the general form: "A planner, prompt, model response, plugin,
tool output, child subgraph, or patch can narrow but never widen authority."
Where this document must choose, it chooses the narrower reading, because the
three contracts must not disagree about what "narrow" means.

`redaction-semantics.md` §10.1 classifies a post-executor failure by the
`sideEffects` value committed with `NodeScheduled`: `none` is
`safe-new-attempt`, while `idempotent`, `non-idempotent` and `unspecified` are
`in-doubt-effect` for which "automatic retry is forbidden" and which "may not
fabricate the lost output or retroactively write `NodeSucceeded`". Section 7
below is the authorized, non-automatic path out of that state, and it preserves
both prohibitions.

## 2. Documents

Three machine schemas form this contract set, and a native implementation MUST
NOT claim the contract by implementing a subset:

| Surface | Machine artifact |
| --- | --- |
| Authority policy and the canonical scope shape | [approval-authority.schema.json](approval-authority.schema.json) |
| Request and the `HumanInputRequested` payload | [approval-request.schema.json](approval-request.schema.json) |
| Grant and the `HumanInputReceived` payload | [approval-grant.schema.json](approval-grant.schema.json) |

All three are exact objects: unknown members, duplicate members, and explicit
null optionals are invalid. Omission, never null, selects optional behaviour.
Integers are finite mathematical integers inside the portable JSON safe-integer
range, so JSON `1.0` is integer one in both languages while booleans are never
integers.

### 2.1 Event payloads

`spec/event.schema.json` declares `HumanInputRequested` and `HumanInputReceived`
in its closed `type` enum and declares `data` as an open object. This contract
freezes both payloads:

- `HumanInputRequested.data` is
  `approval-request.schema.json#/$defs/humanInputRequestedData`: exactly
  `apiVersion`, `kind`, `request`, and `document`.
- `HumanInputReceived.data` is
  `approval-grant.schema.json#/$defs/humanInputReceivedData`: exactly
  `apiVersion`, `kind`, and `grant`.

`document` is the exact document under approval, serialized verbatim. For a
barrier that resolved to `human` it is the frozen `BarrierDecision` document,
unaltered — which is how this contract satisfies the barrier contract's
requirement that the event "carry the decision document". The binding
`request.subject.documentHash == documentHash(document)` is REQUIRED; without it
the pair is two unrelated values in one envelope.

This contract does **not** modify `spec/event.schema.json`. Referencing these
two definitions from the event schema, so that the open `data` object is closed
per event type, is integration-lane work and is an open obligation recorded in
Section 12.

## 3. Canonical serialization and framing

`canonicalSerialize` is the existing canonical Graph IR serialization: object
members in ascending Unicode code-point order of their keys, arrays in
declaration order, no insignificant whitespace, strings escaped as by the shared
canonical JSON rules, and finite numbers only.

`frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)`.

`framedDigest([p₀ … pₙ]) = SHA-256(frame(p₀) || … || frame(pₙ))`, lowercase hex.

This is the identical construction
`integrated-barrier-semantics.md` uses for `policyHash` and `decisionId`, and it
is used here for the same reason it gives:

> Explicit byte lengths make concatenation injective, so no field boundary can
> be forged by crafted content.

### 3.1 Why the byte lengths are load-bearing here

Unlike the barrier constructions, the part lists below are **field-by-field**
and are not redundant with a whole-document serialization. That makes the
framing the only thing preventing a boundary forgery, and the corpus proves it
with a concrete pair of well-formed requests.

Take two requests identical in every member except that the first declares
`runId: "run1"`, `graphRevision: 23` and the second declares `runId: "run12"`,
`graphRevision: 3`. Both are valid: `run1` and `run12` both satisfy the run
identifier pattern, and `23` and `3` are both revisions at or above one. Under a
naive concatenation the two byte streams are identical, because
`"run1" || "23" == "run12" || "3" == "run123"`, so the two distinct requests
would share one identity and a grant issued for either would satisfy the other.
Under the framing they differ, because the length prefixes differ:

```text
… 00 00 00 04 "run1"  00 00 00 02 "23"  …
… 00 00 00 05 "run12" 00 00 00 01 "3"   …
```

An implementation MUST NOT compute any identity in this contract by
concatenating parts without their byte lengths, and MUST NOT substitute a
separator character for the length prefix, because a separator is forgeable by
content that contains it.

### 3.2 The five constructions

```text
authorityHash = framedDigest([
  "graphengineering.approval-authority.v1alpha1",
  canonicalSerialize(authority)
])

documentHash = framedDigest([
  "graphengineering.approval-subject-document.v1alpha1",
  canonicalSerialize(document)
])

requestHash = framedDigest([
  "graphengineering.approval-request-document.v1alpha1",
  canonicalSerialize(request)          // complete, including requestId
])

requestId = framedDigest([
  "graphengineering.approval-request.v1alpha1",
  runId,
  decimal(graphRevision),
  nodeId,
  operationKind,
  subject.kind,
  subjectIdText,
  subject.documentHash,
  sideEffects,
  canonicalSerialize(requestedScope),
  authorityId,
  authorityHash,
  requesterPrincipal,
  decimal(leaseFence),
  nonce,
  decimal(requestedAtMs),
  decimal(expiresAtMs)
])

grantId = framedDigest([
  "graphengineering.approval-grant.v1alpha1",
  runId,
  decimal(graphRevision),
  nodeId,
  requestId,
  requestHash,
  operationKind,
  subject.kind,
  subjectIdText,
  subject.documentHash,
  decision,
  approverPrincipal,
  canonicalSerialize(grantedScope),
  authorityId,
  authorityHash,
  decimal(leaseFence),
  decimal(decidedAtMs),
  supersedesGrantId ?? "",
  confirmation ? canonicalSerialize(confirmation) : ""
])
```

`subjectIdText` is `decimal(subject.attempt)` when `subject.kind` is `attempt`
and `subject.decisionId` when it is `decision`. `decimal(n)` is the shortest
base-ten representation with no sign, no leading zero, and no exponent.

An absent optional is framed as the empty string. That is unambiguous for both
optionals: `supersedesGrantId` is either 64 lowercase hex characters or empty,
and `confirmation` is either a serialized JSON object beginning with `{` or
empty. A future member whose value set includes the empty string MUST NOT reuse
this convention.

### 3.3 What each identity does and does not cover

`grantId` covers every non-constant member of the grant. Two grants with equal
`grantId` therefore have equal canonical bytes, up to a SHA-256 collision. This
is what makes the duplicate-presentation rule of Section 5 a byte-exactness test
rather than a name match, and it is why that rule needs no separate byte
comparison: a presentation whose carried `grantId` matches a committed grant but
whose bytes differ is already refused by the `grant-identity` guard, which
recomputes the identity before anything is compared to the ledger.

`requestId` covers every non-constant member of the request **except `reason`**.
The exclusion is deliberate: `reason` is human-facing prose that carries no
authority, and two operators wording the same request differently must not
produce two authority-distinct requests. `requestHash` covers the complete
document including `reason`, and a grant carries both, so a grant bound to one
wording cannot be applied to another. Implementations MUST check both; checking
only `requestId` would let a reworded request absorb a grant, and checking only
`requestHash` would lose the field-level binding the framing provides.

## 4. Authority

An `ApprovalAuthority` is a claimed policy if and only if it is a portable
object carrying `apiVersion` exactly
`graphengineering.reacher-z.github.io/approval/v1alpha1` and `kind` exactly
`ApprovalAuthority`. Ownership is a versioned claim the author states, never a
shape a runtime guesses. This mirrors the ownership rule
`integrated-barrier-semantics.md` adopted after two implementation lanes proved
shape inference unimplementable.

`principals` is a closed allowlist and structurally excludes the `system:`
namespace. No runtime-synthesized identity can ever occupy an approver slot.
This is not a convenience: it is the structural half of the never-an-implicit-
grant invariant, because the only remaining way to manufacture a grant would be
to invent an approver, and the schema forbids it.

`onUnanswered` has exactly two members, `refuse` and `unknown`, and no default.
There is deliberately no `approve` member.

`nonIdempotentResume` is a single-member enum fixed at `require-confirmation`,
so no deployment can configure Section 7 away.

`requestTtlMs` bounds `expiresAtMs - requestedAtMs`. A request exceeding it is
`GE_APPROVAL_REQUEST_TTL_EXCEEDED`.

## 5. Idempotency

The approval ledger is a fold of the durable event history. Each
`HumanInputRequested` event contributes one request keyed by its `requestId`;
each `HumanInputReceived` event contributes one grant keyed by its `grantId`
under that request. The ledger is derived, never authoritative on its own; the
event history is the source of truth, exactly as `durable-recovery-semantics.md`
already requires.

**The same approval presented twice grants once.** A presentation whose
recomputed `grantId` equals the `grantId` of a grant already committed for the
same `(runId, requestId)` is a *zero-write replay*:

1. it appends no event;
2. it writes no ledger row;
3. it performs no store, artifact, lease, or checkpoint write;
4. it re-evaluates no freshness condition; and
5. it returns exactly the outcome the committed grant produced.

Point 4 is deliberate and is the one that is easy to get wrong. A grant
committed while fresh does not become forged, stale, or expired because it is
presented again later. Re-running the staleness guards on a replay would turn a
correct duplicate delivery into a spurious refusal, and — worse — would make the
outcome of a delivery depend on when the duplicate arrived. The ledger is
authoritative for what was already decided.

A presentation whose recomputed `grantId` differs from every committed grant, in
a request that already has an effective grant, is **not** a replay. It is
`GE_APPROVAL_DUPLICATE_GRANT` unless it is a `revoke` or `supersede` naming the
effective grant. A second `approve` is never a second grant.

Replay of the whole run, in the sense of `durable-recovery-semantics.md` §14.4,
folds the committed grants and contacts no human, invokes no approver surface,
and emits no event. The historical decision is preserved exactly.

## 6. Scope and non-expansion

An `ApprovalScope` has exactly eight members: five token sets
(`operations`, `filesystemWriteRoots`, `networkHosts`, `processExecutables`,
`secretNames`) and three integer ceilings (`maxAttempts`, `maxDurationMs`,
`maxCostMinorUnits`). Every member is REQUIRED, so a scope can never widen by
omission. Token sets are unique and in ascending Unicode code-point order, so
canonical serialization is deterministic and comparison is unambiguous.

`A ⊑ B` ("A is no wider than B") holds if and only if:

- for each of the five token sets, every member of `A` is a member of `B` under
  **exact string equality**; and
- `A.maxAttempts ≤ B.maxAttempts`, `A.maxDurationMs ≤ B.maxDurationMs`, and
  `A.maxCostMinorUnits ≤ B.maxCostMinorUnits`.

No prefix, suffix, glob, case-insensitive, Unicode-folding, or path-normalizing
match participates. `/var` does not cover `/var/tmp`, and `example.test` does
not cover `sub.example.test`. Prefix matching is rejected because it makes
`/var` cover `/var/../etc`, and because it makes a widening invisible: an
approver reading `/var` cannot enumerate what it authorizes.

The **empty scope** is all five sets empty and all three ceilings zero. It is
the only scope a refusal may carry.

Two non-expansion obligations hold, and they are separate rules with separate
codes:

- `request.requestedScope ⊑ authority.maxScope`, else
  `GE_APPROVAL_SCOPE_EXCEEDS_AUTHORITY`. This is checked before any approver is
  contacted; an authority cannot be asked to exceed itself.
- `grant.grantedScope ⊑ request.requestedScope`, else
  `GE_APPROVAL_SCOPE_EXPANSION`. **An approval may narrow what was requested; it
  may never widen it.**

A third obligation applies only to supersession and reports the same code
through a different guard:

- for `decision: "supersede"`, `grant.grantedScope ⊑ superseded.grantedScope`,
  else `GE_APPROVAL_SCOPE_EXPANSION`. Supersession is monotone narrowing.
  Re-widening after a narrowing would let two grants that are each individually
  legal compose into one that is not.

A refusal (`reject`, `revoke`, `expire`) that carries a non-empty scope is
`GE_APPROVAL_REFUSAL_GRANTS_SCOPE`. It is a distinct code rather than a scope
expansion because the defect is categorical: the document refuses and confers in
the same breath, and reporting it as a narrowing failure would understate it.

## 7. Confirmation for a resumed in-doubt node

`request.sideEffects` echoes the value committed with `NodeScheduled` for the
node under approval.

`confirmation` is REQUIRED if and only if the decision confers authority
(`approve` or `supersede`) **and** `request.sideEffects` is not `none`. It is
FORBIDDEN otherwise. The two directions are separate codes,
`GE_APPROVAL_CONFIRMATION_REQUIRED` and `GE_APPROVAL_CONFIRMATION_FORBIDDEN`,
because they are different mistakes: the first resumes an in-doubt effect
without a human stating what happened, the second attaches an external-state
claim to an operation that has no external state.

`confirmation.sideEffects` MUST equal `request.sideEffects`, else
`GE_APPROVAL_CONFIRMATION_MISMATCH`. An approver confirming a different class of
effect than the one in doubt has confirmed nothing.

`confirmation.action` has two members and each has a required observation:

- `new-attempt` re-fires the effect and REQUIRES
  `observedExternalState: "verified-not-applied"`. Any other observation is
  `GE_APPROVAL_UNVERIFIED_REATTEMPT`. An approver who has not verified that the
  effect did not land MUST NOT be able to authorize firing it again; this is the
  entire point of the plan's "resuming a non-idempotent node requires
  confirmation", and a confirmation that does not carry a verified observation
  is a click, not a confirmation.
- `adopt-applied` continues past an effect the approver verified as applied and
  REQUIRES `observedExternalState: "verified-applied"`. Any other observation is
  `GE_APPROVAL_UNVERIFIED_ADOPTION`.

`observedExternalState: "unverified"` therefore authorizes nothing. It exists so
that an approver can record the truth instead of guessing, and so the durable
history distinguishes "nobody knew" from "somebody checked".

`adopt-applied` does not fabricate the lost output and does not retroactively
write `NodeSucceeded`, exactly as `redaction-semantics.md` §10.1 requires. The
node's output remains unbound and Section 9.3 governs what may be scheduled.

Abandoning an in-doubt node needs no confirmation block: it is
`decision: "reject"`, a refusal, and it confers nothing.

## 8. Staleness, forgery, and fork

These are three different failures and MUST NOT be reported through one code.

**Forgery** is a claim that does not hold together: a recomputed identity that
differs from the carried one, or a grant whose binding fields disagree with the
request it names. Codes: `GE_APPROVAL_REQUEST_IDENTITY_MISMATCH`,
`GE_APPROVAL_GRANT_IDENTITY_MISMATCH`, `GE_APPROVAL_REQUEST_BINDING_MISMATCH`,
`GE_APPROVAL_SUBJECT_MISMATCH`, `GE_APPROVAL_NONCE_REUSE`.

**Staleness** is a well-formed grant against a world that has moved on. The
grant is genuine; it is simply no longer applicable. Codes:

- `GE_APPROVAL_STALE_REVISION` — `grant.graphRevision` is not the run's current
  graph revision. A grant approves an operation on a specific compiled graph; a
  patched graph is a different operation.
- `GE_APPROVAL_STALE_FENCE` — `grant.leaseFence` is below the run's live lease
  fence. Another orchestrator has taken the run over, so the authority the grant
  was issued under has been retired. This is the same fencing rule
  `durable-recovery-semantics.md` and master plan §14.3 already require at every
  event, artifact, checkpoint and patch commit; an approval is not exempt.
- `GE_APPROVAL_EXPIRED` — `grant.decidedAtMs` is after `request.expiresAtMs`. A
  decision taken after the window closed is not a decision on that request.

An implementation MUST NOT report a stale grant as forged, and MUST NOT report a
forged grant as stale. Conflating them destroys the operational signal: a stale
grant means "reissue the request", a forged grant means "investigate".

Staleness is also never silence. A stale grant is refused with its code; it is
not dropped, not retried, and not accepted with a warning.

**Fork.** A grant binds `runId`. A forked child run therefore cannot adopt a
parent's grant: the recomputed `requestId` and `grantId` under the child's run
identity differ, and every binding field disagrees. This is the same argument
`integrated-barrier-semantics.md` makes for decisions —

> Because `decisionId` binds `runId`, a forked run recomputes and re-emits its
> own decision identity for any node it re-executes, and a parent decision
> adopted verbatim by a child run is a `DECISION_IDENTITY_MISMATCH` rather than
> a silent reuse.

— and this contract reaches the same refusal by the same mechanism. It reports
it through its own codes rather than through `DECISION_IDENTITY_MISMATCH`,
because the barrier code names a decision carrier this contract does not govern,
and because an authority policy has a legitimate rebind path that a durable
decision does not:

- `authority.forkTransfer: "never"` → `GE_APPROVAL_FORK_TRANSFER_DENIED`. The
  child must obtain approval on its own terms or not proceed.
- `authority.forkTransfer: "bound-reapproval"` → `GE_APPROVAL_FORK_REBIND_REQUIRED`.
  The child MUST emit a fresh `ApprovalRequest` bound to its own `runId`,
  `graphRevision`, and lease fence, with `operationKind: "fork-rebind"`, and
  obtain a fresh grant. The parent grant is evidence in the request's `reason`
  and never authority.

Neither member permits verbatim reuse. This is `redaction-semantics.md` §8.4's
"approvals are never copied as authority across runs" and master plan §14.5's
"stale approvals do not transfer unless an explicit authority policy allows a
bound re-approval", stated as two codes.

A transplanted grant is detected before the generic subject-binding guard, so an
operator sees `FORK_*` rather than `SUBJECT_MISMATCH` and learns *why* the
binding failed. Detection is by lineage: the presentation carries the run's
`forkedFromRunId`, and a grant whose `runId` equals it is a transplant.

## 9. Resumption and discharge

### 9.1 What a granted approval may do

An approval authorizes a *continuation*. It never rewrites history.

A granted approval MUST NOT: mutate any committed event; change a committed
`BarrierDecision` or `RouteDecision` in any member; change a node's recorded
terminal status; re-run a barrier's satisfaction arithmetic; re-read upstream
values; bind a value to an edge the producing node did not bind; or cause a
second decision event for a node that already has one. Zero-rejudge replay, as
frozen by `integrated-barrier-semantics.md`, is unaffected by this contract.

### 9.2 Barrier discharge

A barrier node whose committed decision carried `resolution: "awaiting_human"`
is **discharged** when, and only when, all of the following hold:

1. a grant for that node passes every guard in Section 10 with outcome
   `granted`;
2. `grant.operationKind` is `resume-barrier`;
3. `grant.nodeId` equals the decision document's `barrierNodeId`;
4. `grant.subject.kind` is `decision` and `grant.subject.decisionId` equals that
   document's `decisionId`;
5. `grant.subject.documentHash` equals `documentHash(BarrierDecision)`; and
6. the grant is effective — not revoked and not superseded by a refusal.

A discharged barrier remains unsatisfied, remains terminal `awaiting_human`,
remains bound to `satisfied: false` and its original `reasonCode`, and still
binds no output. Only the scheduler's permission to proceed changes.

### 9.3 A discharge never fabricates a value

Because the barrier binds no output, descendants reachable only through it are
scheduled with that edge unbound.

If any such descendant declares a required input port fed by the barrier's
outgoing edge, the discharge is REFUSED with
`GE_APPROVAL_UNBINDABLE_DESCENDANT`, before any descendant is scheduled and with
zero executor calls. An approval may authorize continuation; it may never
substitute null, an empty object, a default, a stale value, or a caller-supplied
replacement for a value the barrier refused to produce. This is the same
prohibition `redaction-semantics.md` §8.3 states for recovery.

Such a graph is not resumable through approval at all. The honest repair is a
graph change, and a graph change is a new revision, which by Section 8 requires
a new request.

### 9.4 Disclosed normative decision: run-terminal precedence

`integrated-barrier-semantics.md` freezes:

> Run terminal precedence is extended, highest first: `failed`, `cancelled`,
> `awaiting_human`, `unknown`, `succeeded`.

Taken alone, a discharged barrier would hold the run at `awaiting_human`
forever, because its node terminal never changes. That would make discharge
pointless.

**Decision.** The five-member precedence list is unchanged and no member is
added. What changes is which nodes occupy the `awaiting_human` rank: a node
whose terminal is `awaiting_human` **and** which is discharged under Section 9.2
is excluded from the fold entirely and contributes no rank. A node whose
terminal is `awaiting_human` with no grant, with a refused grant, or with an
`unknown` outcome keeps rank `awaiting_human` exactly as frozen.

This is stated as a decision, not derived. The alternative — adding a sixth
terminal such as `human_resolved` — was rejected because it would edit a frozen
list, would require every existing precedence implementation to change, and
would create a terminal that is neither success nor failure for a node that
already has one. The alternative of letting a discharged barrier report
`succeeded` was rejected outright: the barrier contract forbids it in terms, and
it would relabel an unsatisfied barrier as satisfied, which is the exact defect
the barrier contract exists to prevent.

### 9.5 Never an implicit grant

The outcome vocabulary is closed at three members: `granted`, `refused`,
`unknown`.

`granted` is produced by exactly one input class: a presented grant with
`decision` in `{approve, supersede}` that passes all 34 guards. Every other
input — a failing presentation, any of the three refusing decisions, an
unreachable approver, a closed window with no answer, an open window still
waiting — is `refused` or `unknown`.

| Situation | Outcome | Ledger writes |
| --- | --- | --- |
| Grant passes all guards, `decision` in `{approve, supersede}` | `granted` | 1 |
| Grant passes all guards, `decision` in `{reject, revoke, expire}` | `refused` | 1 |
| Grant fails any guard | `refused` | 0 |
| Byte-exact duplicate presentation | outcome of the committed grant | 0 |
| No grant, window open | `unknown` | 0 |
| No grant, window closed, `onUnanswered: "refuse"` | `refused` | 0 |
| No grant, window closed, `onUnanswered: "unknown"` | `unknown` | 0 |
| Approver unreachable | `unknown` | 0 |

An unanswered request is never converted into a grant document. There is no
synthetic approver principal, the schema forbids one, and a runtime MUST NOT
invent one. This is the barrier contract's own invariant for unsatisfied
barriers, applied to approvals: insufficient evidence never becomes a pass.

A failing presentation writes nothing at all. It appends no event, so a hostile
party cannot grow the durable history by replaying malformed grants, and a
refusal is not mistaken later for a decision somebody took.

## 10. The presentation pipeline

A presentation is evaluated by 34 guards in the fixed order below. **The first
guard that reports a code decides the outcome**; later guards are not evaluated.
The order is normative so that two runtimes report the same code for an input
that violates several rules at once.

`idempotent-replay` is the one guard that short-circuits with a success rather
than a code.

| # | Guard | Code |
| ---: | --- | --- |
| 1 | `shape-request` | `GE_APPROVAL_MALFORMED` |
| 2 | `shape-grant` | `GE_APPROVAL_MALFORMED` |
| 3 | `request-ttl` | `GE_APPROVAL_REQUEST_TTL_EXCEEDED` |
| 4 | `request-identity` | `GE_APPROVAL_REQUEST_IDENTITY_MISMATCH` |
| 5 | `grant-identity` | `GE_APPROVAL_GRANT_IDENTITY_MISMATCH` |
| 6 | `idempotent-replay` | *(none — zero-write replay)* |
| 7 | `request-binding` | `GE_APPROVAL_REQUEST_BINDING_MISMATCH` |
| 8 | `fork-transfer-denied` | `GE_APPROVAL_FORK_TRANSFER_DENIED` |
| 9 | `fork-rebind-required` | `GE_APPROVAL_FORK_REBIND_REQUIRED` |
| 10 | `subject-binding` | `GE_APPROVAL_SUBJECT_MISMATCH` |
| 11 | `operation-kind-echo` | `GE_APPROVAL_OPERATION_KIND_MISMATCH` |
| 12 | `nonce-reuse` | `GE_APPROVAL_NONCE_REUSE` |
| 13 | `authority-drift` | `GE_APPROVAL_AUTHORITY_DRIFT` |
| 14 | `authority-operation-kind` | `GE_APPROVAL_OPERATION_KIND_MISMATCH` |
| 15 | `principal` | `GE_APPROVAL_PRINCIPAL_NOT_PERMITTED` |
| 16 | `separation` | `GE_APPROVAL_SEPARATION_VIOLATION` |
| 17 | `authority-ceiling` | `GE_APPROVAL_SCOPE_EXCEEDS_AUTHORITY` |
| 18 | `scope-non-expansion` | `GE_APPROVAL_SCOPE_EXPANSION` |
| 19 | `refusal-empty-scope` | `GE_APPROVAL_REFUSAL_GRANTS_SCOPE` |
| 20 | `stale-revision` | `GE_APPROVAL_STALE_REVISION` |
| 21 | `stale-fence` | `GE_APPROVAL_STALE_FENCE` |
| 22 | `expiry` | `GE_APPROVAL_EXPIRED` |
| 23 | `ledger-terminal` | `GE_APPROVAL_TERMINAL_STATE` |
| 24 | `ledger-no-prior` | `GE_APPROVAL_NO_PRIOR_GRANT` |
| 25 | `ledger-supersede-target` | `GE_APPROVAL_SUPERSEDE_TARGET_INVALID` |
| 26 | `ledger-consumed` | `GE_APPROVAL_ALREADY_CONSUMED` |
| 27 | `ledger-duplicate` | `GE_APPROVAL_DUPLICATE_GRANT` |
| 28 | `supersede-monotone` | `GE_APPROVAL_SCOPE_EXPANSION` |
| 29 | `confirmation-required` | `GE_APPROVAL_CONFIRMATION_REQUIRED` |
| 30 | `confirmation-forbidden` | `GE_APPROVAL_CONFIRMATION_FORBIDDEN` |
| 31 | `confirmation-match` | `GE_APPROVAL_CONFIRMATION_MISMATCH` |
| 32 | `confirmation-reattempt` | `GE_APPROVAL_UNVERIFIED_REATTEMPT` |
| 33 | `confirmation-adoption` | `GE_APPROVAL_UNVERIFIED_ADOPTION` |
| 34 | `descendant-bindability` | `GE_APPROVAL_UNBINDABLE_DESCENDANT` |

Three codes are reported by two guards each: `GE_APPROVAL_MALFORMED` (1, 2),
`GE_APPROVAL_OPERATION_KIND_MISMATCH` (11, 14), and
`GE_APPROVAL_SCOPE_EXPANSION` (18, 28). In each pair the two guards are
independently reachable — a request-side defect versus a grant-side defect, an
echo mismatch versus an authority restriction, a request-relative widening
versus a supersession-relative widening — so the corpus isolates each guard even
though the portable code does not distinguish them. Section 11.2 records the
measurement.

### 10.1 Ledger state

Guards 23 through 28 read the folded ledger for the presentation's `requestId`:

- `effective` — the grant currently conferring authority, if any. It is the most
  recent `approve` or `supersede` that has not been revoked or superseded.
- `terminal` — true once a `reject`, `expire`, or `revoke` has committed. No
  further grant is admissible for that request:
  `GE_APPROVAL_TERMINAL_STATE`.
- `consumed` — true once the authority conferred by `effective` has been acted
  on: a descendant scheduled, an external effect fired, a patch applied. A
  `revoke` against a consumed grant is `GE_APPROVAL_ALREADY_CONSUMED`. Authority
  already exercised cannot be withdrawn retroactively; the honest response is a
  compensating operation, which is itself an approvable operation.

`revoke` and `supersede` REQUIRE `supersedesGrantId`, and it MUST name the
current `effective` grant. Naming a grant that is not effective, or naming one
when no grant is effective, is `GE_APPROVAL_SUPERSEDE_TARGET_INVALID`; presenting
`revoke` or `supersede` when the ledger holds no grant at all is
`GE_APPROVAL_NO_PRIOR_GRANT`.

`approve`, `reject`, and `expire` are first decisions. Presenting one when a
grant is already effective is `GE_APPROVAL_DUPLICATE_GRANT` — unless it is the
byte-exact replay of guard 6, which never reaches here.

## 11. Conformance

### 11.1 Obligations

A conforming implementation MUST consume
[conformance/approval.case.json](conformance/approval.case.json) literally and
prove:

1. exact schema validation parity for all three documents, including JSON `1.0`
   as an integer, boolean rejection, unknown members, explicit nulls, and the
   `subject` and `supersedesGrantId` conditional cardinalities;
2. literal `authorityHash`, `documentHash`, `requestHash`, `requestId`, and
   `grantId` values, recomputed independently in each language and never
   imported from the other;
3. the naive-concatenation collision of §3.1 — that the two requests share a
   digest without framing and differ with it;
4. that a single-member perturbation of any framed part changes the identity;
5. the member-wise scope subset relation, including one widening vector per
   scope member and the exact-equality rule against prefix matching;
6. the ordered pipeline, including that an input violating several rules reports
   the earliest guard's code;
7. every one of the 30 codes, every one of the 3 outcomes, every one of the 5
   decisions, every one of the 6 operation kinds, every one of the 4
   `sideEffects` members, every one of the 3 `observedExternalState` members,
   and both `forkTransfer`, both `separation`, and both `onUnanswered` members;
8. zero-write replay, with a write count of exactly zero and an outcome equal to
   the committed grant's, including a replay presented after the graph revision
   and lease fence have both advanced;
9. that a second distinct `approve` is `GE_APPROVAL_DUPLICATE_GRANT` and not a
   second grant;
10. the three staleness codes, each distinct from every forgery code, on inputs
    that are otherwise entirely valid;
11. both fork codes, on a parent grant adopted verbatim by a child run;
12. the confirmation matrix, including that `unverified` authorizes nothing;
13. barrier discharge, including `GE_APPROVAL_UNBINDABLE_DESCENDANT`, and that a
    discharged barrier is still `satisfied: false`, still terminal
    `awaiting_human`, and still binds no output; and
14. that no failing presentation writes anything.

### 11.2 Mutation adequacy

A corpus that only re-derives a golden run is not evidence. The binding
obligation on this corpus is a mutation criterion, in the form
`subgraph-and-edge-semantics.md` §15.1 established:

> For every rejection rule the oracle implements, at least one vector must exist
> that isolates it — deleting that rule from the oracle must make the shipped
> corpus fail.

The oracle implements this mechanically. `approval.validate.mjs` accepts
`--neutralize=<guardId>`, which makes that guard always return no code. Invoked
with no arguments it validates the corpus and then sweeps: it neutralizes each
of the 34 guards in turn and requires the corpus to fail every time. A guard
that survives its own deletion is printed by name and the process exits
non-zero. `--no-sweep` validates without sweeping.

On the corpus as shipped, **all 34 guards are held**: neutralizing any one of
them makes `approval.case.json` fail. There are no survivors. The three
double-reported codes of Section 10 are each isolated by a vector that reaches
one guard with the other satisfied, so the shadowing that
`subgraph-and-edge-semantics.md` §15.1 had to disclose does not arise here.

The sweep is part of the gate: running the validator with no arguments performs
the full sweep and fails if any guard survives. Coverage of all 30 codes, all 3
outcomes, and every closed enum member is likewise a hard failure rather than a
report.

## 12. Non-goals, open obligations, and honest claims

**Non-claims.** This contract claims no capability. Specifically:

- No TypeScript or Python runtime implements any part of it. There is no
  approval issuer, no approver surface, no grant validator, no ledger fold, and
  no discharge path in this repository.
- No signature, PKI, attestation, or cryptographic identity of the approver is
  defined. `approverPrincipal` is a name checked against an allowlist; it is not
  proof that the named human acted. This contract makes forgery of the *binding*
  detectable; it does not make impersonation of the *approver* detectable. A
  deployment that needs that must add it, and this document must not be cited as
  providing it.
- No multi-approver quorum, threshold, delegation, or escalation chain exists.
  One request takes one decision from one principal.
- No approval transport, notification, timeout scheduling, or UI is defined.
- Nothing here grants the barrier, router, quorum, deadline, or decision-replay
  capabilities that `integrated-barrier-semantics.md` also declares unclaimed.
  A barrier still cannot evaluate a threshold, so the discharge path of Section
  9 has no reachable producer today.
- `spec/event.schema.json` is unchanged by this contract. Until the integration
  lane references §2.1's two definitions from it, `HumanInputRequested.data` and
  `HumanInputReceived.data` remain open objects on the wire and any validation
  of them is contract-author evidence only.

**Open obligations**, none closed here:

1. Reference `humanInputRequestedData` and `humanInputReceivedData` from
   `spec/event.schema.json`, closing `data` per event type.
2. Register the three schemas and the corpus in `spec/README.md` and in the
   shared fixture validator, so the oracle runs in CI rather than only by hand.
3. Record the three schemas and the corpus as expected artifacts in the task
   registry, so release-map and evidence-closure checks can see the machine
   contract.
4. Implement the pipeline in both runtimes and join them, recomputing every
   literal in each language.
5. Decide whether approver authentication belongs in this contract or in a
   separate one. Until then the impersonation gap above is an accepted,
   disclosed limitation of an alpha contract.
