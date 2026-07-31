# Durable execution extension semantics v1alpha1

Status: contract-only. No TypeScript or Python runtime implements any rule in
this document. The schemas, the corpus and the oracle are normative together;
schema acceptance alone is neither conformance nor durability evidence. The
contract identity is `durable-extension/v1alpha1` and the wire API version is
`graphengineering.reacher-z.github.io/durable-extension/v1alpha1`.

This document freezes the contract required by master-plan section 14 for
leases and fencing, authoritative event history, checkpoint acceleration,
replay, fork, the `ArtifactStore` and `LockManager` extension interfaces, and
storage-provider neutrality. It unblocks `D9-TS-DURABLE-EXT-032`,
`D9-PY-DURABLE-EXT-033` and `D9-DURABLE-EXT-CONFORMANCE-034`.

Machine artifacts:

- [`lease.schema.json`](lease.schema.json)
- [`replay-plan.schema.json`](replay-plan.schema.json)
- [`fork-lineage.schema.json`](fork-lineage.schema.json)
- [`artifact-store-descriptor.schema.json`](artifact-store-descriptor.schema.json)
- [`checkpoint-acceleration.schema.json`](checkpoint-acceleration.schema.json)
- [`conformance/durable-extension.case.json`](conformance/durable-extension.case.json)
- [`conformance/durable-extension.validate.mjs`](conformance/durable-extension.validate.mjs)

## 1. Relationship to the contracts already frozen

This contract extends, and must not contradict, two frozen documents.

[`durable-recovery-semantics.md`](durable-recovery-semantics.md) fixes
single-process continuation of one static revision-1 DAG. It states explicitly
that "CAS detects stale writes; it does not prevent two processes from
executing external work before one loses a write race. Distributed resume needs
a real lease/fencing provider." This document supplies that provider contract.
Everything `durable-recovery-semantics.md` says about tagged Durable JSON,
activity keys, commit-before-release, terminal idempotence and the ten stable
`DurableRunError` codes remains in force unchanged.

[`cycle-store-provider-semantics.md`](cycle-store-provider-semantics.md) fixes
provider-side storage semantics for the cycle controller, including a lease
model with epoch and fencing token. This document reuses that model's shape
deliberately: first acquisition starts epoch and fence at one, every later
acquisition or takeover strictly increments both, renewal preserves identity
while strictly extending expiry, takeover requires expiry plus the prior fence,
lease identifiers are never reused, and a stream that has entered fenced
ownership requires the exact active binding thereafter. Two additions are made
here that the cycle contract does not carry, both required by master-plan
section 14.3: a **renewal limit** and a **bound lease policy identity**.

Section 15 records the divergences and gaps found while writing this contract.

## 2. Scope and non-claims

In scope: the authoritative frame, its integrity chain, the fold projection,
lease and fence authority, replay as a read-only fold, fork lineage,
checkpoints as disposable accelerators, non-idempotent resume confirmation,
dual-resume races, the `ArtifactStore` and `LockManager` declarations, and
storage-provider neutrality.

Out of scope, and explicitly not claimed anywhere in this contract:

- exactly-once external effects;
- any durability, crash-safety, fsync, failover, backup or restore evidence;
- distributed fencing evidence for any concrete adapter;
- graph patches, explicit cycles, streaming edges and reducers, which belong to
  [`cycle-semantics.md`](cycle-semantics.md) and
  [`subgraph-and-edge-semantics.md`](subgraph-and-edge-semantics.md);
- redaction of payloads, which belongs to
  [`redaction-semantics.md`](redaction-semantics.md);
- budget arithmetic, which belongs to [`budget-semantics.md`](budget-semantics.md).

## 3. The authoritative event history

### 3.1 The frame

The unit of authority is the **authority frame**, defined by
[`checkpoint-acceleration.schema.json`](checkpoint-acceleration.schema.json)
`#/$defs/authorityFrame`. The definition lives in the checkpoint schema because
the acceleration record is the only document that binds a whole history prefix;
`replay-plan.schema.json` and `fork-lineage.schema.json` reference it from
there.

A frame is a closed object. Its identity fields are:

| Field | Meaning |
| --- | --- |
| `runId`, `eventStreamId` | The bound run and stream; constant across a history. |
| `sequence` | Contiguous from zero. There are no gaps and no renumbering. |
| `eventId` | Unique within one run, including against frames already committed. |
| `type` | A member of the closed frame vocabulary of 3.2. |
| `provenance` | `new` for work this run performed, `inherited` for a fact adopted at fork. |
| `parentSequence` | Non-null exactly when `provenance` is `inherited`. |
| `fence`, `holderId` | The writer's fence token and lease owner at commit. |
| `payload`, `payloadBytes`, `payloadHash` | The frame body, its canonical byte count, and its domain hash. |
| `artifactRef` | Non-null when the payload is carried out of line. |
| `decisionHash` | Domain hash over `[runId, sequence, type, payloadHash]`. |
| `previousFrameHash`, `frameHash`, `historyHash` | The integrity chain of 3.3. |

`decisionHash` binds `runId` structurally. That is the whole mechanism by which
a child run adopting a parent decision verbatim becomes a detectable mismatch
rather than silent reuse; see section 7.

### 3.2 The frame vocabulary

Twenty-four types. Sixteen are members of the shipped v1alpha1 envelope
vocabulary `GRAPH_EVENT_TYPES` at `packages/persistence/src/events.ts:8-31`:

`RunCreated`, `RunStarted`, `RunResumed`, `NodeScheduled`, `NodeStarted`,
`NodeSucceeded`, `NodeAttemptFailed`, `NodeRetried`,
`NodeSettledWithoutAttempt`, `EdgeEmitted`, `ArtifactCreated`, `RouteSelected`,
`BudgetUpdated`, `RunSucceeded`, `RunFailed`, `RunCancelled`.

Eight are durable-extension additions with **no counterpart in the shipped
v1alpha1 envelope**:

`LeaseAcquired`, `LeaseRenewed`, `LeaseTakenOver`, `LeaseReleased`,
`LeaseLost`, `CheckpointRecorded`, `ForkCreated`, `ResumeConfirmed`.

This is disclosed rather than papered over. Master-plan 14.3 requires
"structured loser events", 14.5 requires that "child events distinguish
inherited facts from new work", and 14.2 requires checkpoint facts; none of
those can be expressed in the shipped envelope. An implementation lane adopting
this contract must extend `GRAPH_EVENT_TYPES` and the corresponding Python
vocabulary, or carry durable-extension frames on a separate stream. This
contract does not choose between those; it records that the choice exists. See
15.1.

### 3.3 Integrity

All hashes are lowercase SHA-256 over `domain || canonicalJson(value)` where
the domain is a NUL-terminated ASCII string and canonical JSON sorts object
keys by Unicode code point. The domains are:

```text
graph-engineering/durable-extension-activity/v1alpha1\0
graph-engineering/durable-extension-artifact/v1alpha1\0
graph-engineering/durable-extension-artifact-store/v1alpha1\0
graph-engineering/durable-extension-checkpoint/v1alpha1\0
graph-engineering/durable-extension-decision/v1alpha1\0
graph-engineering/durable-extension-fork-lineage/v1alpha1\0
graph-engineering/durable-extension-frame/v1alpha1\0
graph-engineering/durable-extension-history/v1alpha1\0
graph-engineering/durable-extension-lease/v1alpha1\0
graph-engineering/durable-extension-lease-policy/v1alpha1\0
graph-engineering/durable-extension-payload/v1alpha1\0
graph-engineering/durable-extension-projection/v1alpha1\0
graph-engineering/durable-extension-replay-plan/v1alpha1\0
graph-engineering/durable-extension-value/v1alpha1\0
```

The relations, each independently recomputed by the oracle:

```text
payloadHash   = H(payload,  payload)
payloadBytes  = byteLength(canonicalJson(payload))
decisionHash  = H(decision, [runId, sequence, type, payloadHash])
frameHash     = H(frame,    frame minus {frameHash, historyHash})
historyHash_0 = H(history,  [null, frameHash_0])
historyHash_n = H(history,  [historyHash_{n-1}, frameHash_n])
activityKey   = H(activity, ["activity/v1alpha1", runId, graphRevision, nodeId, inputHash])
```

The activity-key shape deliberately matches
`durable-recovery-semantics.md` lines 171-174, including the exclusion of
`attempt`, so a durable-extension run and a v1alpha1 run compute the same key
for the same logical activity.

`historyHash` is a running chain, not a hash of the whole prefix. A checkpoint,
a replay plan and a fork lineage can therefore each name one sequence and pin
the exact prefix that produced it.

### 3.4 History rules

Rejections are named `DX-H-nnn` and every one is isolated by a corpus vector.

1. `DX-H-001` A frame must declare the durable-extension `apiVersion` and
   `kind: AuthorityFrame`.
2. `DX-H-002` Sequences are contiguous from zero.
3. `DX-H-003` `previousFrameHash` equals the previous frame's `frameHash`, and
   is null exactly at sequence zero.
4. `DX-H-004` `frameHash` is reproducible.
5. `DX-H-005` `historyHash` is reproducible.
6. `DX-H-006` `payloadHash` is reproducible.
7. `DX-H-007` `payloadBytes` is reproducible.
8. `DX-H-008` `decisionHash` is reproducible.
9. `DX-H-009` Every frame names the bound `runId`.
10. `DX-H-029` Every frame names the bound `eventStreamId`.
11. `DX-H-010` `eventId` is unique within the run.
12. `DX-H-011` Sequence zero is `RunCreated`.
13. `DX-H-012` `RunCreated` appears nowhere else.
14. `DX-H-013` No frame follows a terminal frame.
15. `DX-H-014` No node, edge, route, budget, artifact, checkpoint or resume
    frame precedes `RunStarted`. Lease frames may precede it.
16. `DX-H-015` A node with a committed `NodeSucceeded` is never restarted.
17. `DX-H-016` A `NodeStarted` claims exactly the reserved attempt, or exactly
    one more than the interrupted attempt it resumes.
18. `DX-H-017` A `NodeStarted` requires a reservation from `NodeScheduled` or
    `NodeRetried`, unless it resumes an interrupted attempt of the same node.
19. `DX-H-018` An outcome frame requires an open attempt.
20. `DX-H-019` One attempt has at most one outcome.
21. `DX-H-020` An `EdgeEmitted` requires its producer to have committed
    `NodeSucceeded` at a lower sequence. This is the commit-before-release
    invariant on the producing side.
22. `DX-H-021` A `NodeScheduled` requires every inbound edge of that node to
    have been emitted at a lower sequence. This is the same invariant on the
    consuming side: a dependant cannot be scheduled before the upstream commit
    is visible.
23. `DX-H-022` Claimed attempts never exceed `maxTotalAttempts`.
24. `DX-H-023` An inline payload above the provider's `maxInlinePayloadBytes`
    requires a non-null `artifactRef`.
25. `DX-H-024` A terminal frame requires zero open attempts and every scheduled
    node settled.
26. `DX-H-025` The `activityKey` of a `NodeScheduled` or `NodeStarted` is
    reproducible from its own `inputHash`.
27. `DX-H-026` A `NodeRetried` requires a settled predecessor attempt.
28. `DX-H-027` An inherited frame names a parent sequence.
29. `DX-H-028` A new-work frame names no parent sequence.

Corruption is never absorbed. A history containing any violation is refused
whole; there is no best-effort fold of the valid prefix and no partial
projection is returned.

Frames with `provenance: "inherited"` are adopted facts, not new work. They are
subject to every structural rule (1-14, 28, 29) and every authority rule of
section 4, and they contribute to the projection, but they are not subject to
the attempt machine (16-21, 26) because the attempt they describe was claimed
in the parent run. Their correspondence to the parent is enforced by the fork
rules of section 7, not by the fold.

## 4. Lease and fencing protocol

### 4.1 The lease

[`lease.schema.json`](lease.schema.json) defines the lease record and, in
`$defs`, the lease policy and the `LockManager` descriptor. A lease binds a
`resourceKey`, an `ownerId`, a `leaseId`, an `epoch`, a monotonic `fence`,
provider-stamped `acquiredAtMs` and `expiresAtMs`, a `renewalCount` against a
`renewalLimit`, a `policyId` with its `policyHash`, a lifecycle `state`, and a
`leaseHash` over the whole body.

One run's authoritative event stream is one resource key. Two orchestrators
cannot both advance it because every authoritative commit carries the holder's
fence and a frame below the current fence is refused.

### 4.2 Provider time is the only authority

A lease operation frame carries a closed payload:

```json
{
  "mode": "acquire",
  "requestedTtlMs": 60000,
  "providerNowMs": 1700000000000,
  "observedClockMs": 1700000000500,
  "lease": { "...": "the Lease record" }
}
```

`providerNowMs` is the storage authority's clock at the decision.
`observedClockMs` is the holder's own clock and is advisory only. The key set
is closed: a caller may not submit a trusted acquisition or expiry instant, and
a payload carrying one is refused (`DX-L-027`). The two clocks must agree
within the policy's `maxClockSkewMs` or the holder may not self-certify
liveness (`DX-L-026`). This is what "no reliance on wall clock alone for
authority" means operationally, and it is why a deterministic test clock is
sufficient to drive the whole state machine.

### 4.3 Lease rules

1. `DX-L-001` First acquisition on a resource starts fence and epoch at one.
2. `DX-L-002` Every later acquisition or takeover increments the fence by
   exactly one.
3. `DX-L-003` and the epoch by exactly one.
4. `DX-L-004` Acquiring while an owner is active is refused; the expired path
   is takeover.
5. `DX-L-005` Takeover requires the active lease to be expired at
   `providerNowMs`.
6. `DX-L-006` Takeover names the exact prior fence.
7. `DX-L-007` A `leaseId` is never reused on a resource.
8. `DX-L-008` Renewal preserves `leaseId`, `ownerId`, `epoch`, `fence` and
   `acquiredAtMs`.
9. `DX-L-009` Renewal strictly extends expiry.
10. `DX-L-010` Renewal advances `renewalCount` by exactly one.
11. `DX-L-011` `renewalCount` never exceeds `renewalLimit`.
12. `DX-L-012` Renewal or release of an expired binding is refused.
13. `DX-L-013` Release requires the exact active `leaseId`.
14. `DX-L-014` Release names the active fence and epoch; release never lowers
    the retained counters.
15. `DX-L-015` `expiresAtMs` is strictly after `acquiredAtMs`.
16. `DX-L-016` The granted window never exceeds the policy `maxTtlMs`.
17. `DX-L-017` `leaseHash` is reproducible.
18. `DX-L-018` `policyHash` equals the bound policy's hash.
19. `DX-L-019` `renewalLimit` never exceeds the `LockManager`'s `maxRenewals`.
20. `DX-L-020` Fence or epoch exhaustion at `9007199254740991` is a quota
    failure with zero mutation, never a wrap.
21. `DX-L-021` After ownership begins, no frame commits below the active fence.
22. `DX-L-022` After ownership begins, every frame names the active owner.
23. `DX-L-023` A holder whose lease has been declared lost commits nothing.
24. `DX-L-024` `LeaseLost` names a retired lease, never the live one, and is
    recorded by the current holder.
25. `DX-L-025` An acquire whose lease fence equals the current active fence is
    the losing side of a dual resume.
26. `DX-L-026` Holder clock skew beyond the policy bound is refused.
27. `DX-L-027` The lease payload key set is closed.
28. `DX-L-028` A granted lease's `state` is `active`.
29. `DX-L-029` Before ownership has ever begun, frames carry fence zero and a
    null holder.
30. `DX-L-030` On acquire and takeover, `acquiredAtMs` equals `providerNowMs`.
31. `DX-L-031` `requestedTtlMs` equals the granted window.

### 4.4 Dual resume and safe lease loss

Two orchestrators resuming one run produce exactly one durable winner. The
loser is refused at the acquire (`DX-L-025`, `GE_DX_DUAL_RESUME_LOSER`) if it
races for the same fence, and at every subsequent commit (`DX-L-023`) once the
winner has recorded `LeaseLost` against it.

A lease may be lost while external work is still running. That is safe by
construction and not by hope: the loser's in-flight work may still reach the
outside world, but it can never reach the authoritative history, so no
downstream frame is released on its behalf. The corresponding attempt stays
open and in doubt until the winner resolves it under section 6. Losing a lease
never converts an unknown outcome into a known one.

### 5. Checkpoint acceleration

A checkpoint is a disposable accelerator. `authority` is pinned to `false` by
`const`, so there is no wire representation of an authoritative checkpoint at
all — the failure mode cannot be expressed, not merely rejected (`DX-C-001`).

A checkpoint binds the event stream, the run, the through-sequence, the
`historyHash` of that exact prefix, the graph revision, graph and plan hashes,
the write fence and holder, the crash window it was observed in, the ten
projection compartments, its canonical byte count and its content hash.

The ten compartments are exactly those master-plan 14.2 requires:
`reducerState`, `controllerState`, `attempts`, `budgets`, `approvals`, `locks`,
`artifacts`, `routes`, `seen`, `lineage`. The key set is closed and a
checkpoint missing or adding one is refused (`DX-C-012`).

Acceptance rules:

1. `DX-C-002` `contentHash` is reproducible.
2. `DX-C-003` `byteCount` is reproducible.
3. `DX-C-004` `historyHash` matches the authoritative prefix.
4. `DX-C-005` The projection equals the independently folded prefix.
   Reconstruction equality is the whole point: a checkpoint that cannot be
   re-derived is a cache miss, not a fact.
5. `DX-C-006` A checkpoint ahead of the tail is refused.
6. `DX-C-007` A foreign run is refused.
7. `DX-C-008` A foreign event stream is refused — this is the substituted-
   checkpoint case, where a genuine checkpoint of another stream at the same
   sequence is offered.
8. `DX-C-009` A foreign graph or plan hash is refused.
9. `DX-C-016` A foreign graph revision is refused.
10. `DX-C-010` A save below the active fence is refused.
11. `DX-C-011` A save by a non-owning holder is refused.
12. `DX-C-015` Only `committed` and `after-rename` are acceptable observations.
13. `DX-C-017` Resuming from an accepted checkpoint and accumulating only the
    suffix reproduces the authoritative projection byte for byte.

A stale checkpoint — one behind the tail — is **accepted**, and only the suffix
is accumulated onto its projection. `DX-C-017` is a genuine acceleration test,
not a restatement of `DX-C-005`: the prefix is never re-read, so a checkpoint
whose projection is wrong in a way `DX-C-005` did not reach still produces a
different accelerated result.

A checkpoint accelerates the **projection**. It never accelerates
**validation**. The guards of sections 3 through 6 are re-run over the
authoritative history regardless, because the ten compartments do not carry the
attempt machine's private state — reservations, settled attempts and declared
side effects are all absent from them. See 15.7.

A missing or refused checkpoint falls back to a full fold and produces the same
projection. Checkpoint availability is never a correctness requirement.

Crash windows are enumerated by the `crashState` enum and every member is
exercised:

| Observation | Resolution |
| --- | --- |
| `committed` | accepted |
| `before-write` | no checkpoint; full fold |
| `during-temp-write` | torn; refused, full fold |
| `before-rename` | no checkpoint; full fold |
| `after-rename` | accepted |
| `concurrent-resume` | fence below the active fence; refused |

Compaction may not touch authority. Reducing the frame count (`DX-C-013`) or
changing any `frameHash` (`DX-C-014`) is `GE_DX_CHECKPOINT_NOT_AUTHORITATIVE`.

## 6. Non-idempotent resume

An interrupted attempt — a `NodeStarted` with no committed outcome — has an
unknown result. The declaration on its `NodeScheduled` governs resume:

| `sideEffects` | Resume |
| --- | --- |
| `none` | permitted |
| `idempotent` | permitted, reusing the same `activityKey` |
| `non-idempotent` | requires an explicit `ResumeConfirmed` frame |
| `undeclared` | fails closed exactly like `non-idempotent` |

The confirmation names the exact node, attempt and `activityKey`, an operator
identity, and a disposition of `retry`, `compensate` or `abandon`. Rules:

1. `DX-N-001` A non-idempotent resume without confirmation is refused.
2. `DX-N-002` A confirmation naming a different activity is refused.
3. `DX-N-003` A confirmation naming a different attempt is refused.
4. `DX-N-004` An undeclared resume without confirmation is refused.
5. `DX-N-005` The `activityKey` is stable across attempts of one node.
6. `DX-N-006` A confirmation for a node with no open attempt is refused.
7. `DX-N-007` An abandoned attempt is never restarted.

The interrupted attempt stays consumed. Its successor is attempt `N + 1`, which
matches `durable-recovery-semantics.md` line 301.

This contract records an approval decision as a durable frame. That is a
deliberate advance over `durable-recovery-semantics.md` lines 296-299, which
fails closed with `IN_DOUBT_SIDE_EFFECT` and states that an approval protocol
is outside the v1alpha1 slice. Under this extension the refusal is unchanged
when no confirmation exists; what is added is a way to record one.

## 7. Fork

[`fork-lineage.schema.json`](fork-lineage.schema.json) binds a child run to a
fixed parent prefix: parent run, parent event stream, parent through-sequence,
parent history hash, parent graph revision, an artifact disposition, an
authority disposition, both run identities, the changed identity fields, the
enumerated inherited facts, the generation, the ancestor chain, and a lineage
hash over the whole body.

**The parent is never mutated.** The lineage names a prefix by hash; any change
to the parent breaks `DX-F-005`, and no child frame may target the parent
stream (`DX-F-019`).

**A parent decision adopted verbatim is a mismatch, not silent reuse.** Every
inherited fact carries both the `parentDecisionHash` and the
`childDecisionHash`. Because `decisionHash` is computed over
`[runId, sequence, type, payloadHash]`, the two can only be equal if the child
copied the parent's decision identity rather than minting its own. That is
refused as `GE_DX_FORK_IDENTITY_REUSE` (`DX-F-002`), and the child hash must
independently reproduce under the child's own run and sequence (`DX-F-003`).

Fork rules:

1. `DX-F-001` The child run identifier differs from the parent's.
2. `DX-F-002` No inherited fact adopts the parent's decision identity.
3. `DX-F-003` Every `childDecisionHash` is reproducible under the child run.
4. `DX-F-004` Every inherited fact matches the parent frame and decision.
5. `DX-F-005` `parentHistoryHash` matches the parent prefix.
6. `DX-F-006` `parentThroughSequence` is within the parent history.
7. `DX-F-007` `changedIdentityFields` equals the recomputed difference between
   the two identities. A changed graph, plan, input, implementation, policy or
   authority therefore becomes new identity by construction.
8. `DX-F-008` The child's `RunCreated` declares exactly the bound child
   identity. Declaring the parent's identity is reuse.
9. `DX-F-009` Every inherited child frame is enumerated.
10. `DX-F-010` Every enumerated fact has an inherited child frame.
11. `DX-F-011` No inherited fact reaches past the bound prefix.
12. `DX-F-012` An attempt still open at the bound prefix is in doubt and may
    not be inherited. Unsafe external effects are never reclassified as
    completed.
13. `DX-F-013` An approval transfers only under `authorityDisposition:
    "inherit-bound"`.
14. `DX-F-014` A transferred approval is rebound to the child identity; a
    parent-bound activity key does not carry over.
15. `DX-F-015` The generation advances by one.
16. `DX-F-016` The ancestor chain extends the parent's.
17. `DX-F-017` The ancestor chain length equals the generation minus one.
18. `DX-F-018` `lineageHash` is reproducible.
19. `DX-F-019` No child frame targets the parent event stream.
20. `DX-F-020` `artifactDisposition: "drop"` inherits no artifact fact.
21. `DX-F-021` Every inherited artifact is digest verified against the store.
22. `DX-F-022` The child stream records exactly one `ForkCreated` naming this
    lineage.
23. `DX-F-023` Every inherited fact names the parent frame's own type.

The ancestor chain of an unforked run is empty and its own lineage identity is
`H(fork-lineage, {"root": runId})`, so a second-generation fork's ancestor list
is exactly that one hash. Multi-generation lineage is therefore recomputable
without consulting any run other than the immediate parent.

## 8. Replay

Replay is a read-only fold. [`replay-plan.schema.json`](replay-plan.schema.json)
binds a run, a stream, an optional through-sequence, a projection mode of
`result`, `state` or `trace`, the seven expected identities, an effect budget,
the observed effects, the preserved in-doubt facts, and a plan hash.

The effect ledger is the enforcement mechanism. Ten channels are enumerated —
`eventAppends`, `checkpointWrites`, `artifactMutations`, `leaseOperations`,
`nodeExecutions`, `modelCalls`, `toolCalls`, `providerCalls`, `randomDraws`,
`currentClockReads` — and `effectBudget` pins every one to `const: 0`. A replay
that appended an event, wrote a checkpoint, mutated an artifact, touched a
lease, re-executed a node, called a model, tool or provider, drew a random
value, or read the current clock has no valid representation. The corpus
carries one isolating vector per channel and the campaign asserts that the
executed channel set equals the declared inventory, so a channel that quietly
stops being checked fails the run rather than passing.

`nodeExecutions: 0` is the machine form of "replay never re-executes a
successful node". The corpus proves the traceable history is reconstructed
without it.

Replay rules:

1. `DX-R-001` The plan names this contract version.
2. `DX-R-002` A sequence beyond the tail is refused, never clamped.
3. `DX-R-003` Each of the six bound identities matches `RunCreated`.
4. `DX-R-004` `expected.historyHash` matches the prefix.
5. `DX-R-005` Every observed effect channel is zero.
6. `DX-R-006` The effect budget is all zeros.
7. `DX-R-007` The rendered projection equals the independent fold.
8. `DX-R-008` `unknownFacts` equals the folded open attempts exactly.
9. `DX-R-009` `planHash` is reproducible.
10. `DX-R-010` A corrupt history surfaces as corruption, never as a truncated
    fold.
11. `DX-R-011` The plan is bound to its own stream.
12. `DX-R-012` No node named in `unknownFacts` appears as succeeded. Replay
    preserves in-doubt facts and never resolves them.

A terminal history replays to its recorded result, appends nothing, and invokes
nothing, which preserves the terminal idempotence of
`durable-recovery-semantics.md` lines 311-317.

## 9. ArtifactStore and LockManager

[`artifact-store-descriptor.schema.json`](artifact-store-descriptor.schema.json)
is the closed extension-interface declaration a provider publishes before
durable work. It carries the `ArtifactStore` surface and the `LockManager`
binding together, because a provider that cannot fence cannot safely own
artifacts either.

It declares a backend from the six master-plan 14.6 requires (`memory`,
`jsonl`, `local-file`, `sqlite`, `postgres`, `s3-compatible`), an addressing
mode, `sha256` as the only digest algorithm, a durability class, twelve closed
capability booleans, four operational limits, and the lock-manager descriptor.

Provider rules:

1. `DX-A-001` `descriptorHash` is reproducible.
2. `DX-A-002` Content addressing requires the capability.
3. `DX-A-003` `distributedFencing: true` requires `multi-host-durable`.
4. `DX-A-004` and a provider clock.
5. `DX-A-005` and the fence predicate inside the write transaction.
6. `DX-A-006` An artifact's digest matches its bytes.
7. `DX-A-007` An artifact's byte count matches its bytes.
8. `DX-A-008` An artifact within the declared object ceiling.
9. `DX-A-009` A content-addressed identifier is derived from the digest.
10. `DX-A-010` An unresolvable reference is `GE_DX_ARTIFACT_UNAVAILABLE`,
    never a fabricated empty object.
11. `DX-A-011` A run requiring an undeclared capability is refused.
12. `DX-A-012` The lock manager can honour the bound lease policy.
13. `DX-A-013` Every declared backend folds one history to one projection.
14. `DX-A-014` No declared limit exceeds the contract ceiling.
15. `DX-A-015` `memory`, `jsonl` and `local-file` cannot claim
    `multi-host-durable`.

Rules 3-5 and 15 mirror the capability matrix of
`cycle-store-provider-semantics.md` lines 293-310: a class is a claim about
evidence already gathered, never about the client library in use. Merely using
a database driver establishes nothing.

Storage-provider neutrality is asserted mechanically, not asserted in prose:
the oracle folds the same authoritative history once per declared backend and
requires one identical projection (`DX-A-013`). A provider whose fold differs
is not a provider of this contract. The oracle drives one reference fold per
declared backend rather than six real adapters, so this establishes that the
contract admits no backend-dependent projection; it does not establish that any
concrete adapter obeys it. That is the job of the implementation lanes.

## 10. The projection

The fold produces the ten compartments listed in section 5. Ordering is fixed
so two implementations produce identical bytes: `succeededNodeIds`,
`settledWithoutAttempt` and `emittedEdgeIds` sort by Unicode code point;
`openAttempts` sorts by node identifier; `approvals`, `artifacts`, `routes` and
`seen` retain commit order; object keys sort by code point through the
canonical encoding.

`seen` carries every folded `eventId` in commit order. Duplicate membership is
a history violation (`DX-H-010`), not a projection detail.

## 11. Error codes

Twenty stable codes. Every one is exercised by at least one corpus vector, and
the campaign fails if any is unexercised.

| Code | Raised when |
| --- | --- |
| `GE_DX_ARTIFACT_INTEGRITY` | An artifact's bytes, digest, size or identity disagree. |
| `GE_DX_ARTIFACT_UNAVAILABLE` | A referenced artifact cannot be resolved. |
| `GE_DX_CHECKPOINT_NOT_AUTHORITATIVE` | A checkpoint claims authority, or compaction touches events. |
| `GE_DX_CHECKPOINT_REJECTED` | A checkpoint is unusable; fall back to a full fold. |
| `GE_DX_DUAL_RESUME_LOSER` | The losing side of a resume race is refused. |
| `GE_DX_FORK_IDENTITY_REUSE` | A child reuses a parent run or decision identity. |
| `GE_DX_FORK_LINEAGE_INVALID` | A lineage relation to the parent is wrong. |
| `GE_DX_HISTORY_CORRUPT` | An integrity relation is broken. |
| `GE_DX_HISTORY_INVALID` | A semantic history relation is broken. |
| `GE_DX_IDENTITY_MISMATCH` | A bound identity or a stored hash is not reproducible. |
| `GE_DX_INVALID_ARGUMENT` | A closed shape, key set or bound is violated. |
| `GE_DX_LEASE_CONFLICT` | A lease lifecycle transition is inadmissible. |
| `GE_DX_LEASE_EXPIRED` | An operation names an expired binding. |
| `GE_DX_PROVIDER_UNSUPPORTED` | A provider cannot honour a declared requirement. |
| `GE_DX_QUOTA_EXCEEDED` | A budget, ceiling or counter space is exhausted. |
| `GE_DX_RENEWAL_LIMIT_EXCEEDED` | A lease exceeds its renewal limit. |
| `GE_DX_REPLAY_SIDE_EFFECT` | A replay touched an external channel. |
| `GE_DX_REPLAY_UNSUPPORTED` | A replay names an unsupported version or sequence. |
| `GE_DX_RESUME_CONFIRMATION_REQUIRED` | An unsafe resume lacks an explicit confirmation. |
| `GE_DX_STALE_FENCE` | A writer's fence or identity is not current. |

`GE_DX_HISTORY_CORRUPT` and `GE_DX_HISTORY_INVALID` are deliberately distinct,
following the same split as `durable-recovery-semantics.md`: bytes that do not
hash are corruption; frames that hash but contradict each other are invalid.

## 12. Bounds

| Bound | v1alpha1 ceiling |
| --- | ---: |
| lease TTL | 86,400,000 ms |
| inline event payload | 1,048,576 bytes |
| checkpoint canonical bytes | 16,777,216 |
| page size | 256 |
| identifier length | 128 |
| fence, epoch, sequence, attempt | 9,007,199,254,740,991 |

A provider may declare a smaller bound. It may never declare a larger one
(`DX-A-014`). Exhaustion is a quota failure with zero mutation
(`DX-L-020`), never a wrap.

## 13. Conformance corpus

[`conformance/durable-extension.case.json`](conformance/durable-extension.case.json)
carries `contractStatus: "contract-only-native-implementation-required"` and
`implementationClaim: false`, and the oracle asserts both.

It contains:

- five schemas under strict Draft 2020-12 Ajv compilation;
- three hash-chained runs — a 30-frame parent that succeeds, a 13-frame child
  forked from it that fails, and a 4-frame run that is cancelled — covering all
  24 frame types;
- three checkpoints, five replay plans and one fork lineage;
- six storage descriptors covering all six backends and all four durability
  classes;
- 148 semantic negative vectors, one or more per rule;
- 24 schema-negative documents; and
- positive coverage tables for crash states, side-effect resumes, artifact
  dispositions, authority dispositions, lease states, replay modes, backends
  and durability classes.

Every literal is recomputed rather than echoed. The oracle re-derives the seven
identity hashes from their source documents, the lease policy hash, every
descriptor hash, every artifact digest and byte count, every frame's payload
hash, byte count, decision hash, frame hash and history hash, every activity
key, every checkpoint content hash and byte count, every replay plan hash and
the fork lineage hash. A single wrong byte anywhere in the corpus fails the
campaign.

Coverage is a hard failure, never a silent pass. The campaign fails if any
declared error code, replay effect channel, bound identity field, frame type,
crash state, lease state, side-effect declaration, artifact disposition,
authority disposition, backend or durability class is unexercised, and it fails
if the corpus and the oracle's own rule inventory are not equal in both
directions.

Negative loops assert counts and executed sets. Deleting a vector changes the
declared count and fails; deleting all of them fails with the count assertion
rather than printing zero and passing.

Mid-history vectors reseal. A semantic substitution recomputes every later
`previousFrameHash`, `frameHash` and `historyHash`, so the chain guard cannot
absorb the mutation and mask the rule under test. Vectors that target the chain
guards themselves do not reseal. This requirement is normative, and it is the
mechanism `subgraph-and-edge-semantics.md` section 15.1 identified the hard way.

## 14. Falsifiability

A corpus that only re-derives one golden run is not evidence. The binding
obligation is stated as a mutation criterion:

> For every rejection rule the oracle implements, at least one vector must
> exist that isolates it — neutralizing that rule must make the shipped corpus
> fail.

This is mechanically reproducible rather than asserted. Every rejection is
raised through `fail(ruleId, code, message)` and every rule identifier can be
neutralized from the environment:

```bash
node spec/conformance/durable-extension.validate.mjs
GE_DX_NEUTRALIZE=DX-L-021 node spec/conformance/durable-extension.validate.mjs
GE_DX_MEASURE=1 node spec/conformance/durable-extension.validate.mjs
```

The measurement mode neutralizes each of the 134 rules in turn, runs the whole
campaign, and reports how many the corpus holds.

Two assertions make the criterion sharp. The campaign asserts the **verdict
code** of every vector, which catches a deleted rule, and it also asserts the
**rule identifier** that produced the verdict, which catches a rule shadowed by
a neighbour reporting the same code. A rule that is only reachable behind an
identical neighbouring code would pass a code-only check and fails here.

### 14.1 Measured result

Recorded from `GE_DX_MEASURE=1` on the corpus as shipped:

**134 of 134 rules held.** There are no survivors.

Anyone may re-run the measurement; it needs no harness beyond this file.

## 15. Divergences, gaps and disclosures

### 15.1 The shipped envelope has no lease, fork or checkpoint event

`packages/persistence/src/events.ts:8-31` and its Python counterpart declare 22
event types. None of them can carry a lease grant, a lease loss, a fork, a
checkpoint fact or a resume confirmation. Master-plan 14.3 and 14.5 require all
five. Section 3.2 lists the eight additions explicitly and the corpus separates
them from the sixteen shipped types, so an implementation lane can see exactly
what it must add. This contract does not silently pretend the shipped envelope
already supports it.

### 15.2 There is no LockManager and no ArtifactStore in the repository

`python/src/graph_engineering/persistence/locks.py` is a process-local asyncio
lock helper for one event loop, not a lease manager; it has no fence, no owner,
no expiry and no persistence. `packages/persistence/src/index.ts` exports an
`EventStore` and a `CheckpointStore` and no artifact interface at all. The only
fenced lease in the repository is the CycleStore provider's, at
`packages/runtime/src/cycle-store-provider.ts:2770-2915`, and it is scoped to
the cycle controller rather than to the durable scheduler. Every rule in
sections 4 and 9 is therefore new surface, which is why `implementationClaim`
is `false`.

### 15.3 The CycleStore lease has no renewal limit or policy identity

`cycle-store-provider-semantics.md` lines 190-218 and the implementation at
`packages/runtime/src/cycle-store-provider.ts:2840-2878` renew a lease without
counting renewals and without binding a policy. Master-plan 14.3 requires both.
This contract adds `renewalCount`, `renewalLimit`, `policyId` and `policyHash`.
That is an addition, not a contradiction: a CycleStore lease remains valid
under its own contract. An implementation that wants one lease manager for both
must extend the CycleStore lease record, and doing so changes
`GE_CYCLE_STORE_*` wire bytes.

### 15.4 Epoch and fence are not independent in the shipped provider

In `packages/runtime/src/cycle-store-provider.ts:2827-2831` a lease is created
with `leaseEpoch: state.lastLeaseEpoch + 1` and
`fencingToken: state.lastFencingToken + 1` from the same base, and the SQLite
baseline invariants at
`packages/sqlite/dist/operation-baseline-lease-lock-hold-invariants.d.ts`
enforce `lease_epoch IS fencing_token` as a durable constraint. The two fields
are therefore always equal in that provider and one of them carries no
information. This contract keeps them separate, because master-plan 14.3 names
the fence specifically and an epoch that can advance without a fence is a
useful future degree of freedom, but an implementation lane should know it is
currently mirroring one counter into two columns.

### 15.5 The plan's checkpoint list contains a compartment with no event source

Master-plan 14.2 requires a checkpoint to carry `routes`. Nothing in
`durable-recovery-semantics.md` emits a route fact, and a projection
compartment that is always empty is a vacuous obligation of exactly the kind
the 2026-07-30 audit flagged. This contract therefore folds `RouteSelected` and
`BudgetUpdated` — both already in the shipped vocabulary at
`packages/persistence/src/events.ts:22-24` — so `routes` and `budgets` are
populated by real frames rather than declared and left empty.

### 15.6 Two fork vectors exercise the lineage checker in isolation

`DX-F-013` and `DX-F-014` append an inherited `ResumeConfirmed` frame to the
child history. The fold would refuse that frame under `DX-N-006`, because the
child has no matching open attempt. The two vectors therefore drive the fork
lineage checker directly rather than through the fold. This is disclosed rather
than smoothed over: the approval-transfer rules are exercised, but not through
a history the fold would accept.

### 15.7 The projection compartments cannot accelerate validation

Master-plan 14.2 lists ten checkpoint compartments. Folding a durable-extension
history needs five more pieces of state that none of them carries: outstanding
attempt reservations, the set of settled attempts, the declared side effects of
each node, the set of used lease identifiers, and the set of lost holders. A
checkpoint therefore accelerates projection accumulation only, and every rule
in sections 3 through 6 is re-evaluated against the authoritative history on
resume.

This is not a contradiction of the plan — 14.1 already says "checkpoints are
validated acceleration only" — but it is a consequence that was not written
down anywhere, and an implementer who reads 14.2 as a resume-state list will
build something that cannot re-validate. `DX-C-017` is scoped to projection
equality for exactly this reason, and the first probe of any implementation
should be to confirm that a resume from a checkpoint still refuses a history
the full fold refuses.

### 15.8 A defect found in this oracle during its own construction

The first version of the acceleration check folded the complete history and
compared it to the complete fold. It passed, and it proved nothing. It was
replaced with `accumulateProjection`, which starts from the checkpoint's own
projection and never reads the prefix. The tautology is recorded here rather
than quietly deleted, because it is the same shape of defect the 2026-07-30
audit found in two other contracts, and finding it required running the
neutralization measurement rather than reading the code.

### 15.9 What this contract does not prove

It does not prove that any adapter is durable, that any adapter fences across
hosts, that a crash at any window behaves as the table in section 5 says, or
that two languages agree. The crash table is a contract, not a drill result.
Distributed fencing is a declaration a provider makes and this contract
constrains the declaration's consistency, never its truth. Cross-language
agreement requires `D9-DURABLE-EXT-CONFORMANCE-034`, which does not exist yet.

## 16. Remaining gates

- `D9-TS-DURABLE-EXT-032`: the TypeScript lease manager, artifact store, replay
  and fork implementation.
- `D9-PY-DURABLE-EXT-033`: the same in Python.
- `D9-DURABLE-EXT-CONFORMANCE-034`: the cross-language join over this corpus.
- Envelope extension for the eight frame types of 15.1, in both languages.
- Adapter drills: fsync, process loss, corruption, backup and restore for
  SQLite; concurrent clients, stale-owner fencing and failover for PostgreSQL.
- Integration with the protected-payload carrier before classified payloads are
  persisted under this contract.

Until those pass, this contract is a specification with an executable oracle
and nothing more.
