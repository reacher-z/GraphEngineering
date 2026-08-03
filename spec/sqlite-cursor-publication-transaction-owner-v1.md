# SQLite cursor publication transaction owner v1

Status: contract-frozen redbar. Runtime implementation, protocol completion,
public API, release gate, driver-native throw, and crash/reopen claims are all
false.

## Purpose and evidence boundary

This contract freezes the authority that will eventually own the single
`BEGIN EXCLUSIVE` transaction spanning the complete v1-to-v2 publication. It
also freezes how that transaction reaches one terminal outcome:

- an authenticated active-graph failure rolls the exact transaction back; or
- the exact final commit fence selects the success claim and permits one native
  COMMIT attempt.

This tranche executes no transaction control. Its primary, BEGIN-postflight,
cleanup-fault, and reopen-matrix future targets describe 32 scenarios for later
runtime work; none is an execution record. Every case has
`runtimeExecuted:false`; the fixture has `runtimeExecutedCaseCount:0` and
`contractRuntimeTransactionControlCount:0`. A consumer must not cite those
future counts as evidence that BEGIN, COMMIT, rollback, close, or reopen exists.
The fixture names both five-position vectors explicitly: I/O is ordered BEGIN,
COMMIT, rollback, close, reopen; ownership is ordered failure claim, success
claim, success-authority tombstone, begin-failure cleanup claim, commit-failure
cleanup claim.

The fixture is closed by the combination of Draft 2020-12 JSON Schema, semantic validation, strict
duplicate/prohibited-key parsing, and a domain-separated trusted SHA-256. Its
validator also executes and verifies the trusted roots of the rebind-v2 and
post-consume failure-finalizer contracts.
Schema-only acceptance is not trusted acceptance: consumers must run the
semantic validator and trusted-root comparison.

## Staged owner binding

The owner cannot be keyed by an outer authority before that authority exists.
Binding is therefore one-way and staged:

```text
exact connection + owner registration
  -> BEGIN returned + exact begin receipt / lineage / generation commitment
  -> exact outer publication authority adoption
  -> monotonic failure claim OR success claim
```

Registration completes before native BEGIN I/O and mints an opaque provisional
generation bound to the exact owner, connection, and one-attempt nonce. A
successful postflight promotes that same object into the transaction generation;
every throw or postflight mismatch tombstones it before cleanup. No begin receipt
exists before promotion. This makes “same attempted generation remains active”
authenticatable even when native BEGIN throws. Partial registration leaves no
registry residue. An integer object ID may select a weak-registry bucket but is
never authority; authentication always compares exact live referents.

The begin receipt commits to the exact owner, connection, lineage, generation,
exclusive mode, transaction epoch, `total_changes`, TEMP mutation epoch, and
the single BEGIN attempt. It is not a serialized replacement for those exact
objects.

## Guarded BEGIN outcomes

The definition-time connection owner performs at most one semantic
`BEGIN EXCLUSIVE`. A caller cannot provide an outcome Boolean, callback, thunk,
path, or connection substitute. The runtime must inspect its exact connection
intrinsic:

1. BEGIN returned and the exact exclusive generation is active: promote the
   provisional generation, mint the begin
   receipt and enter `active`.
2. BEGIN returned but postflight observes autocommit, a different generation,
   or an unavailable intrinsic: mint a stable postflight primary, do not
   rollback an unproven transaction, close once, and reopen to classify exact
   source-v1, corruption, or unresolved state.
3. BEGIN threw and the exact same provisional generation is demonstrably active: preserve
   the BEGIN exception as primary, tombstone begin authority, rollback once,
   close once, and reopen to prove source-v1.
4. BEGIN threw and autocommit is verified: do not rollback; close once and
   reopen to prove source-v1.
5. BEGIN threw and observation is unavailable: do not guess and do not
   rollback; close and reopen. If reopen is unavailable, report unresolved.

No branch retries BEGIN. A thrown property getter, closed connection, different
generation, or substituted owner is not evidence of the same active
transaction.

## Direct presentation and transitive authentication

Direct success presentation contains exactly two objects: the transaction
owner and exact final commit fence. The success path does not accept Rule 11,
raw seal evidence, Rule 12, clock evidence, cursor/clock completion, retirement
evidence, or a Boolean as an alternative authority.

The final fence transitively authenticates the exact graph below it: outer
authority, Rule 11, Rule 12, pre-verification clock, cursor-clock completion,
lineage and metadata publication, publication rules, fresh-v2 equivalence,
physical/semantic audit, pre-retirement fence, TEMP retirement, and pre-commit
clock. The commit intrinsic consumes the fence; it does not require a caller to
re-present every ancestor and thereby create a second authentication path.

The fixture freezes the full 30-stage order from a semantically valid source-v1
through the single atomic commit. In particular:

```text
Rule 11
  -> Rule 12
  -> pre-verification clock / cursor-clock complete
  -> lineage, metadata, rules, fresh-v2, physical and semantic receipts
  -> pre-retirement stage fence
  -> exact cursor TEMP retirement
  -> pre-commit clock
  -> final migration-lock transaction fence
  -> internal success selection (mints no new capability)
  -> one atomic COMMIT
```

Validation precedes destructive fence consumption; consumption precedes native
COMMIT I/O. Permanent writes after the pre-retirement fence and owned TEMP
residue at commit are forbidden.

## Outcome arbiter

The arbiter claim is monotonic:

```text
unclaimed -> failure-claimed
          \-> success-claimed
```

At most one outcome claim is live. A failure claim blocks success. A success
claim blocks the existing post-consume failure owner. If COMMIT later throws
while the exact same generation is still active, cleanup remains internal to
the success claim:

```text
success-claimed
  -> committing
  -> success-authority-tombstoned
      -> close/reopen for returned or in-doubt outcomes
      \-> internal commit-failure cleanup owner for exact-active throw
          -> rollback once
```

This is not a historical success-to-failure arbiter crossover, and it does not
reuse the post-T finalizer, whose accepted primary and graph are different.
Success authority must be explicit; `ContextVar`, copied context, ambient state,
structural equality, proxy, clone, subclass, or reconstruction cannot carry it.

## Transaction-control and write guards

Protecting only a convenience `commit()` method is insufficient. While an owner
is active, the future connection guard covers:

- native commit and rollback methods;
- SQL `COMMIT`, `END`, `ROLLBACK`, and nested `BEGIN`;
- `SAVEPOINT`, `RELEASE`, and `ROLLBACK TO` proof-history changes;
- prepared, scripted, or multi-statement transaction-control execution;
- close of the live guarded connection; and
- new or already-prepared permanent DML/DDL after the pre-retirement fence.

The final item is a floor, not a whitelist. Persistent PRAGMAs (including
`user_version`/`application_id`), `VACUUM`, `ANALYZE`, `REINDEX`,
`ATTACH`/`DETACH`, connection-topology changes, and every other permanent-state
or transaction-proof-history mutation are guarded as well.

The exact driver API used for commit/rollback may differ between TypeScript and
Python; the contract freezes the semantic operation on the exact owned
connection, not a caller-controlled SQL string.

## COMMIT ambiguity

After COMMIT throws, rollback is authorized only if all of these facts hold:
the exact connection is live, native in-transaction is true, the exact lineage
is still selected, the generation commitment and epoch are unchanged, and
exclusive mode remains selected.
“Epoch unchanged” compares against the exact pre-COMMIT-attempt snapshot and
permits only the single owner-recorded commit-attempt accounting transition;
any other epoch movement rejects rollback authorization.

The outcomes are:

1. COMMIT returned: never rollback; close and reopen must prove complete-v2.
2. COMMIT threw and the exact same generation remains active: preserve the
   COMMIT exception as primary diagnostic, tombstone success authority, mint
   the internal cleanup owner, rollback once, close once, and reopen must prove
   source-v1.
3. COMMIT threw and autocommit is verified: commit-in-doubt; no rollback; close
   and reopen to classify exactly source-v1 or complete-v2.
4. COMMIT threw and another generation is active, or observation is
   unavailable: commit-in-doubt; no rollback; close and reopen or report
   unresolved.

There is no commit retry. Autocommit alone never proves complete-v2. A reopen
result is a single value, never the pseudo-result “source-v1-or-complete-v2.”

Rollback also has honest ambiguity states. A returned rollback may enter
`rolled-back`. A thrown rollback enters `rollback-failed`; if the transaction
is still exact-active or cannot be observed it proceeds through
`rollback-in-doubt`. Neither state may claim rolled-back. Both still attempt
close exactly once and rely on reopen classification. Close failure never
suppresses the reopen attempt.
The future cleanup matrix distinguishes a throw before native return, an
after-native-return injected throw, and an outcome-unavailable throw; none of
those future rows activates the still-false driver-native throw claim.

## Reopen classifier and API outcome

Reopen uses a definition-time captured opaque database capability. A caller
cannot select a path or callback after ambiguity; in-memory databases are not
eligible for a production recoverable owner.

Source-v1, complete-v2, and corruption require more than `user_version` or
autocommit. The independent auditor checks exact reopen identity, application
ID and version, physical catalog digest, schema/descriptor/lineage metadata,
baseline count/root, cursor count/root/targets, operation-sequence and legacy
replay commitments, migration-lock terminal state, `integrity_check`, and
`foreign_key_check`.

API results are frozen as follows:

- commit-in-doubt + exact source-v1: commit failed;
- commit-in-doubt + exact complete-v2: recovered success;
- any required-success/rollback result with an incompatible or intermediate
  database: corruption;
- unavailable reopen evidence: unresolved, never guessed success.

The executable future matrix covers all four reopen classifications after
COMMIT returned, rollback completed, and COMMIT-in-doubt. The in-doubt row
applies independently to verified autocommit, different-generation-active, and
observation-unavailable, so none of those observations silently collapses into
the one unavailable-reopen example.

Corruption may dominate the API outcome, but it retains the original native
BEGIN/COMMIT exception as the primary diagnostic. Rollback is secondary, close
is tertiary, and reopen audit evidence follows. Cleanup faults never overwrite
the original primary, rollback failure still leads to one close attempt, and
no cleanup operation is retried.

## Retention and crash boundary

A live owner may strongly present the exact final fence and its opaque reopen
capability. Terminalization clears the graph; the terminal snapshot contains
only pure scalar evidence and no path, exception graph, address, connection,
authority, or receipt. Abandoned owner graphs are collectible, and stale weak
callbacks must match the exact stored entry before deleting it.

The registry’s “connection” is a weakref-capable owner wrapper, never the raw
driver handle; the provisional/promoted generation is likewise an opaque
weakref-capable bearer. This keeps the contract implementable in Python, where
the raw `sqlite3.Connection` and a plain `object()` are not weak-referenceable.

Opaque in-process identity cannot survive a process crash. The future crash
auditor must classify durable state and mint new proof; this contract does not
claim that implementation or evidence today.

## Next implementation boundary

The first runtime tranche may implement registration, the terminal guard, and
guarded BEGIN/failure cleanup only. Production COMMIT remains disabled until
Rule 12, both remaining clock transitions, downstream publication/audit
receipts, TEMP retirement, and the exact final fence are implemented and
independently audited in both runtimes.
