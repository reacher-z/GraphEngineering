# SQLite cursor publication owner composition P11

Status: **P11-A redbar contract**. This document freezes the contract that an
implementation must satisfy; its presence is not evidence that P11-B, P11-C,
or P11-D has shipped.

Machine-readable companions:

- `spec/sqlite-cursor-publication-owner-composition-p11.routes.json`
- `spec/sqlite-cursor-publication-owner-composition-p11.stages.json`

The normative design inputs are append-only master-plan sections 31.37.81,
31.37.82, and 31.37.84. Later corrections win: 31.37.84 overrides resource
retirement and EQP-count wording in 31.37.82, and 31.37.82/84 override the
initial design in 31.37.81. Existing P8, P9, and P10 fixtures remain immutable.

## 1. Purpose and hard boundary

P9 owns the exact file-backed connection, guarded `BEGIN EXCLUSIVE`, failure
capture, rollback/close/reopen cleanup, and the disabled COMMIT boundary. P10
owns the exact R11 -> R12 -> third-clock-observed-but-unconsumed suffix. P11
may accept a path only when one opaque composition proves that both halves
belong to the same P9 owner, BEGIN receipt, connection, lineage, generation,
and source-v1 fingerprint, and every lower mutation is authorized by a
bounded route-specific scope.

The longest successful P11 path is the continuous 30-stage prefix 1..17 plus
auxiliary third-clock evidence with observed/consumed counts `3/2`. The
auxiliary evidence is not stage 18. Every P11 success and failure keeps:

- `thirdEvidenceConsumed=false`;
- `commitPresented=false`;
- `commitAttemptCount=0`;
- stage 18 `pre-verification-clock-evidence-consumed=false`.

Only a P11-D success reports `highestAcceptedStage=17`. Failures derive their
highest stage from retained receipts. P11 does not mint cursor-clock-complete,
publish lineage or metadata, accept later rules, prove fresh-v2, retire TEMP,
select success, COMMIT, reopen complete-v2, export a public API, or prove a
release/star outcome.

## 2. Opaque authorities and provenance

The TypeScript package-private authority is
`SQLiteCursorPublicationOwnerComposition`; Python uses the private equivalent.
Neither runtime exports the composition, mutation scope, child permit, fixed
read permit, transaction owner, BEGIN receipt, or failure capture from a
package root.

The only composition mint input is the exact P9 owner object and its exact
current BEGIN receipt. It does not accept a connection, path, lineage,
generation, watermark, SQL string, digest, callback, boolean proof, or caller
snapshot. The owner module must recover and reauthenticate all of those facts
from definition-time-captured private registries.

Before minting, the module proves:

1. exact type and object identity for owner and receipt;
2. active, one-shot owner lifecycle and the current unretired receipt;
3. the same connection, exclusive lineage, provisional/promoted generation;
4. a still-active native transaction and exact BEGIN postflight watermarks;
5. exact absolute file identity, source-v1 fingerprint, and recoverability;
6. no earlier composition, clone, proxy, subclass, reconstruction, or
   cross-run/cross-owner presentation.

The composition strongly retains owner, receipt, connection, lineage,
generation, and source fingerprint until P9 failure finalization or a future
success finalizer. Every B2 stage, outer authority, session, rebind, R11, R12,
and third-clock successor strongly retains the same composition object.
Connection equality or copied scalar evidence is never sufficient.

Snapshots expose immutable scalar evidence only. They may say that exact owner
and receipt authentication succeeded, but never expose an owner, receipt,
scope, permit, native statement/cursor, file handle, path authority, or mutable
buffer.

### 2.1 BEGIN and current watermarks

The immutable BEGIN receipt keeps
`beginTransactionEpoch/beginTotalChanges/beginTempMutationEpoch`. Legal P11
writes advance separate composition and owner-current values
`currentTransactionEpoch/currentTotalChanges/currentTempMutationEpoch`.
Changing BEGIN receipt fields to mimic current state is forbidden. Each scope
records exact pre/post values and expected deltas; native, owner, composition,
outer-ledger, and route counters must reconcile after every child.

### 2.2 Atomic adoption

Adoption order is fixed:

1. authenticate owner and receipt;
2. construct every immutable object without publishing it;
3. register composition and exact owner/receipt binding;
4. mark the receipt composition-pending;
5. one-way adopt in owner state;
6. publish composition state `begin-adopted`.

The caller cannot observe the composition before step 6. Registration,
binding, pending, and owner-adopt each have a one-shot fault seam. A failure
preserves the original primary, removes partial registry entries, tombstones
all constructed authorities, and immediately uses the same P9 failure-capture
and finalizer. Once owner adoption succeeds, no failure may restore
`unadopted` or allow a retry.

## 3. Composition state machine

The only success state path is:

```text
unadopted
 -> begin-adopted
 -> b2-scope-active -> b2-complete
 -> outer-clock-consumed -> outer-active
 -> migration-0002-scope-active -> post-ddl-fenced
 -> baseline-entries-scope-active
 -> baseline-header-scope-active
 -> operation-sequence-zero-scope-active
 -> initial-stage-adopted
 -> pre-rebind-clock-consumed -> session-active
 -> cursor-rebind-scope-active
 -> rule11-complete -> rule12-complete
 -> third-observed-unconsumed
```

Each state has one legal successor. Skip, reorder, repeat, cross-owner,
cross-connection, cross-generation, or cross-run presentation terminally
poisons the graph. A pending or entered authority never counts as an accepted
30-stage receipt.

An opened authorization window that fails follows:

```text
phase-active -> failure-pending/poisoned
 -> exact-P9-failure-capture
 -> rolling-back | rollback-in-doubt
 -> close
 -> reopen-source-v1 | corrupt | unavailable
 -> finalized
```

## 4. Route classification and complete-default policy

The route fixture classifies every relevant native path into exactly one of:

| Classification | Meaning |
| --- | --- |
| `pre-registration` | Fixed TEMP configuration writes/reads completed and frozen before owner registration. |
| `public-harmless-select` | Existing bounded, single-statement, genuinely read-only public SELECT/WITH behavior; never a P11 special-read escape. |
| `authenticated-fixed-read` | Exact owner/composition/phase/SQL/parameters/budget permit required. |
| `scoped-mutation` | Exact owner/composition/phase/route/SQL/parameters/ordinal mutation authority required. |
| `forbidden` | Rejected before prepare, execute, cursor creation, or any native I/O. |

Unknown is always `forbidden`. A new callsite, new route ID, changed exact SQL
byte, changed digest, new parameter source, changed row/cursor budget, or new
runtime alias must update the route fixture and hostile tests before it can run
under an active P11 owner. Token classification, SQL hash alone, caller route
names, and ambient booleans are not authorization.

P11-A freezes a count policy for each of the six mutation descriptors that its
zero-I/O lattice can mint. `main.migration-0002` requires exact count 20.
`b2.cursor-seal-table-ddl`, `main.baseline-header`,
`main.operation-sequence-zero`, and `main.cursor-rebind` each require exact
count 1. Only `main.baseline-entries` accepts a bounded dynamic count, in the
inclusive range 0..1024. This is a shape constraint, not evidence that a
source projection produced that count. Its machine policy therefore keeps
`requiresFutureExactCountProvenance=true` and
`zeroIsOnlyShapeUntilReceipt=true`. Deleting, widening, substituting, or
moving a count policy to another descriptor is contract drift and fails
before mutation authority or native I/O.

P11-A may additionally bind an exact immutable retained-projection identity to
one opaque, owner/generation/route-bound, one-shot projection-count receipt.
The receipt computes its count from the retained container through captured
intrinsics; it never accepts a caller-supplied scalar. The baseline-entry parent
must strongly retain the consumed receipt, and the receipt state must strongly
retain the exact projection, until the parent becomes terminal. Scalar zero,
mutable/sparse/subclass/proxy containers, cloned or replayed receipts, and
cross-composition presentation fail closed through the exact P9 cleanup path.
Presentation against the wrong composition must not poison the foreign source
receipt, because that would turn the verifier into a cross-owner denial-of-
service primitive.

This zero-I/O receipt proves only projection identity and count. A package
caller can still present an immutable empty container, so the receipt does not
prove that a native lower-owned reader produced that container and does not
authorize a genuine-zero claim. Its scalar snapshot must therefore expose
`nativeSourceProvenance=false`, `genuineZeroClaim=false`,
`actualNativeIoCount=0`, and `sqlAuthority=false`. Native-source provenance,
root/entry authentication, execute-N binding, and genuine N=0 remain red until
the lower-owned runtime reader mints or adopts the projection under its own
closed authority.

The route fixture inventories the actual plan modules in both runtimes. The
audit includes baseline source/stage/handoff/cooperation/reconcile, all
stream/record/checkpoint/lease/lock/hold/legacy/cursor invariant paths, cursor
ownership/campaign, outer/subprotocol/rebind/R12/third/clock, transaction owner,
and the TypeScript connection guard. Module aliases of one exact SQL route do
not create a second route. Runtime-specific SQL formatting has its own exact
digest; portable identity is the frozen route ID plus its runtime binding.

### 4.1 Pre-registration routes

`PRAGMA temp_store = FILE`, bounded `temp.cache_size`, and
`PRAGMA cache_spill = ON` execute only before registration. Their three fixed
verification reads also finish before registration and produce a frozen
receipt. `temp_store_directory` is forbidden. If an owner-active B2 path must
re-read TEMP configuration, it needs a distinct fixed-read permit and proves
zero epoch/total/TEMP delta; it cannot reuse pre-registration authority.

### 4.2 B2 scoped mutations

B2 route domains are separate parent scopes:

- 13 exact TEMP table DDL children;
- 10 exact TEMP index DDL children;
- one exact relation-key TEMP view DDL child;
- the fixed common-stage insert;
- 12 fixed normalized relation insert routes;
- exact cursor-seal TEMP table DDL;
- exact cursor-seal INSERT.

Dynamic counts come only from authenticated source/projection counts and remain
within existing resource limits. A single global ordinal across different SQL
domains is forbidden. The owner-composed failure path never runs DROP: rollback,
close, and reopen remove partial TEMP state. Legacy non-owner unit fixtures may
retain their old local DROP behavior, but it is not P11 evidence.

### 4.3 Permanent scoped mutations

The only permanent route families before the P11 terminal boundary are:

1. the trusted migration-0002 asset, exactly 20 ordered statements;
2. baseline entries, exact INSERT, prepare once and execute N retained entries;
3. baseline header, exact INSERT `1/1`;
4. operation sequence zero, exact INSERT `1/1`;
5. cursor rebind, exact UPDATE, prepare/execute `1/1`, affected rows N.

The first, third, fourth, and fifth child-owned descriptor counts are frozen
as 20, 1, 1, and 1 respectively. Baseline entries alone is bounded-dynamic
0..1024. Until a future lower-owned exact retained-projection/count receipt is
adopted, P11-A may demonstrate only reusable state-machine shapes for N=0 or
N>0. It cannot report those shapes as genuine retained-entry cardinality.

Asset substitution, statement replacement, reorder, skip, repeat, extra
statement, caller row injection, caller parameters, or execution outside the
scope is rejected before I/O. The migration asset digest and all 20 statement
digests are frozen in the route fixture.

### 4.4 Global denylist

P11 rejects all BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE presentations,
ATTACH/DETACH, VACUUM/ANALYZE/REINDEX, persistent PRAGMA, scripts or multiple
statements, non-allowlisted main/TEMP DDL or DML, caller SQL/callback/digest,
prepared handles outside their authority, phase/owner/connection crossover,
consumed-authority replay, post-poison DROP, and P11 TEMP retirement.

Public `prepare/exec/execute/executescript/commit/rollback/close` never accept a
P11 scope or permit. A scope cannot be converted into a generic connection
capability. Raw `COMMIT` and owner commit presentation are both unavailable;
all reports keep commit attempts at zero.

### 4.5 Conservative native-callsite triage

Discovery and authorization are deliberately separate layers. The syntax
scanner preserves every candidate and assigns a stable identity containing at
least repository-relative path, line, column, method, SQL origin, and a digest
of those fields. Receiver triage may place a candidate in exactly one of:

- `confirmed-native-receiver`, only from locally provable runtime types,
  constructors, or same-scope alias/property derivation;
- `wrapper-guard-or-test-like-production-probe`, only from an exact known
  wrapper/guard type or captured wrapper method;
- `false-positive`, only when local syntax proves a non-SQLite receiver; or
- `unknown`, which is the mandatory default for name hints, cross-file return
  guesses, unresolved members, computed callables, or conflicting evidence.

TypeScript and Python classifiers are independent and deterministic. They may
use runtime-specific structural evidence, but receiver names never increase
confidence, duplicate candidates are not collapsed, and an unknown is never
dropped. These four triage categories do not change `routeClassification`:
every candidate remains route-unknown until its exact SQL/parameter/phase/
owner/budget/resource contract is fixture-bound or explicitly forbidden.
Consequently classification progress never by itself changes
`routeClosureClaimed=false` or the acceptance requirement of zero unknown
native routes.

## 5. Lower native execution contract

No ContextVar, AsyncLocal, thread-local, process-global flag, ambient stack, or
"currently authorized" boolean may carry P11 authority. Each lower writer
explicitly receives an opaque scope/child permit. Definition-time-captured
owner hooks implement authorize-before, native-returned, and failed.

Before one native mutation, the lower boundary must:

1. authenticate exact presentation type and object identity;
2. reprove owner, composition, connection, lineage, generation, live lock,
   current watermarks, and target catalog;
3. verify phase, predecessor, route ID, exact SQL bytes/digest, ordinal, and
   package-owned parameter provenance;
4. enter the child or execution lease;
5. package-own prepare/execute without a caller callback;
6. record native return and affected-row evidence;
7. retire a one-shot resource or release a reusable execution lease;
8. run postflight and advance exact child/parent/current watermarks;
9. consume the child, then complete/retire/consume the parent when N is done.

An exception invokes the failed hook, poisons child/parent/composition, retains
the original primary, and clears the authorization window in `finally`.
Missing, wrong, clone, proxy, subclass, replayed, cross-owner, cross-connection,
wrong-phase, wrong-predecessor, future/past/extra ordinal, or post-consumption
authority fails before native I/O.

## 6. Mutation parent/child models

Every multi-item route has a parent with `expectedCount=N` and strict
`nextOrdinal=0`. A child may be minted only for `nextOrdinal`; the following
child cannot exist until the current child passes postflight and is consumed.

### 6.1 Child-owned one-shot

Migration and independently prepared B2 DDL use:

```text
child-issued -> prepared -> entered -> native-returned
 -> resource-retired -> postflight-accepted -> child-consumed
```

The next ordinal cannot begin before retirement. TypeScript proves the
`StatementSync` handle leaves the owned lexical scope and is not cached;
Python closes the exact cursor with attempt/return `1/1`. Neither runtime
exposes a handle to the caller.

### 6.2 Parent-owned reusable

Baseline entries and any route actually implemented as prepare-once/execute-N
use:

```text
parent prepare once
 -> child execution lease issued -> entered -> execute-returned
 -> lease-released -> postflight-accepted -> child-consumed
 ...
 -> parent resource retired once -> parent-complete -> parent-consumed
```

Portable counts are `prepare=1`, `execute=N`,
`executionLeaseReleased=N`, `parentResourceRetired=1`. A child never owns or
retires the parent handle. TypeScript proves private lexical retention and
terminal reference clearing; Python proves one parent-cursor close attempt and
return. Portable parity never invents a TypeScript native close API.

For a future fully integrated `N=0` path, exact zero provenance must be
authenticated, prepare remains 1, execute and child count are 0, zero-item
postflight runs once, and the parent resource retires once before parent
consumption. P11-A currently has no exact lower-owned/native-source retained-
projection/count receipt. Its zero-I/O projection-count receipt still yields
only a reusable state-machine shape and cannot complete a genuine-zero claim.
A claimed zero without future native-source provenance, or one that disagrees
with the source/projection count, is hostile input. Future tests must distinguish
a genuine zero route from N=0 cursors with nonzero baseline entries.

## 7. Authenticated fixed reads

`SQLiteCursorPublicationFixedReadPermit` is independent from mutation scopes.
It binds exact owner, composition, connection, phase, one route ID, exact SQL
bytes/digest, parameter shape and provenance, maximum rows/cursors, prepare/
fetch/retirement budget, and zero-mutation watermarks.

Its portable state is:

```text
issued -> prepared -> bounded-reading -> terminal-row-observed
 -> resource-retired -> consumed
```

Zero rows still require the terminal fetch and resource retirement. TypeScript
iterator routes prove `iterator.return()`; scalar `StatementSync.get()` routes
prove lexical release and cleared private references. Python cursor routes
prove close attempt/return `1/1`. Preparation, fetch, decode, or retirement
failure poisons the selected graph with primary-over-cleanup precedence and
zero mutation.

The fixed-read inventory includes owner-active TEMP verification when needed,
B2 source/catalog/watermark/invariant/cursor campaign reads, post-DDL source and
catalog reads, R11 affected-count evidence, and the R12 seal readers. Ordinary
public harmless SELECT remains governed by the existing P9 guard and never
widens PRAGMA or EXPLAIN behavior.

### 7.1 B2 EQP set: exactly 15

B2 freezes an independent 15-route EQP set in this order:

1. main cursor source projection;
2. cursor-seal INSERT target;
3. cursor-seal projection;
4. count marker;
5. event binding lookup;
6. checkpoint binding lookup;
7–15. authorization, scope, blob canonical, position, expiry/consumption,
   catalog binding, shape, event binding, and checkpoint binding row markers.

Each probe binds `EXPLAIN QUERY PLAN <exact-target-sql>`, exact target digest,
forbidden plan fragments, and its resource budget. A permit covers one probe,
not all 15.

### 7.2 R12 EQP set: exactly 3

R12 separately freezes main key scan/count, TEMP key driver, and main primary
key point lookup. R12 reauthenticates its existing read authority against the
same composition, lineage, current watermark, live lock, and catalog. Its
three route IDs do not overlap B2 route IDs even where a target SQL digest is
also useful elsewhere.

Validators reject 3 reported as the B2 total, 15 reported as the R12 total,
merged IDs, missing/swapped probes, duplicate IDs, or using one digest to
fabricate another probe. Portable reports carry both ordered ID/digest arrays
and `b2EqpProbeCount=15`, `rule12EqpProbeCount=3`.

## 8. Machine stage inventory and A-D slices

The stage fixture copies the canonical 30-stage order from the P9 transaction
owner fixture and gives every stage a unique ordinal, predecessor, counts, and
slice owner. Stage IDs, not prose ranges, define acceptance.

- **P11-A** implements authority substrate and redbar only; it accepts no
  30-stage completion.
- **P11-B** accepts the continuous prefix through stage 4
  `b2-pre-rebind-complete`.
- **P11-C** continues through stage 11
  `operation-sequence-zero-published`, strictly before initial adoption.
- **P11-D** starts initial adoption at stage 12 and continues through stage 17
  `rule-12-main-table-seal-accepted`, then observes but does not consume the
  third clock.

This resolves the earlier ambiguous "5..12/13..17" wording: P11-C and P11-D
cannot both claim initial adoption. A successful slice report includes the
entire earlier prefix; `acceptedStageIds` is ordered, unique, and continuous.

Every report includes `attemptedStage`, `highestAcceptedStage`,
`acceptedStageReceiptCount`, `acceptedStageIds`, third-consumed flag, commit
presentation, and commit attempts. The attempted failing stage is excluded.
The highest stage is computed from authenticated retained receipts, never from
the fault label or requested slice. A hostile early failure claiming 17 fails
closed.

## 9. Failure capture, cleanup, and bounded stop

The P11 driver is the only accepted orchestration path after BEGIN. Every
synchronous failure selects the exact P9 failure authority. TypeScript wraps
primitive throws deterministically while retaining the original cause. Python
captures the exact original `BaseException`, including `KeyboardInterrupt` and
`SystemExit`, in an opaque one-shot capture whose registry strongly retains
primary identity, owner, connection, lineage, generation, and capture ordinal.
The exact original Python primary is re-raised; a newly created exception is
not an authenticated substitute.

Rollback occurs at most once and only if the finalizer proves the exact owned
generation/lineage remains active. If observation or native access is
unavailable, the finalizer does not guess rollback, but still closes the exact
owned connection and performs bounded absolute-identity reopen/audit. No path
returns early while an active or in-doubt registry entry remains.

Reopen verifies file identity, source-v1 fingerprint, application/user version,
catalog, integrity, and foreign keys. Transactional main writes must be gone,
TEMP must be empty, and classification is source-v1, corrupt, or unavailable.
All live scopes/permits/composition objects are tombstoned and the BEGIN receipt
is retired. Primary beats resource-retirement, rollback, close, and reopen
secondary evidence.

After a successful P11-D test snapshot, teardown uses only the package-private
test adapter with primary `P11_BOUNDED_STOP_NO_COMMIT`. The adapter mints the
same P9 failure capture and runs the same finalizer. It is one-shot, cannot
coexist with another failure capture or future success token, is not a third
rollback authority, and leaves commit attempts at zero. Direct public rollback
or a raw private native rollback is forbidden.

## 10. P11-A red gates

P11-B cannot claim success until both runtimes and the conformance validator
independently demonstrate all of the following:

1. an early fault cannot report stage 17 or include its attempted stage;
2. the exact 20-statement migration child sequence advances one ordinal at a
   time and a postflight failure has `child-failed -> parent-poisoned`;
3. reusable N-row lease shapes remain bounded, while genuine zero count,
   fake zero, zero replay, and N=0-cursor/nonzero-entry completion remain red
   until an exact lower-owned count receipt exists;
4. owner-active fixed PRAGMA and all 15 B2 EQP permits are bounded, retired,
   consumed, and have zero mutation;
5. TypeScript and Python retirement evidence is runtime-real and portable
   parity fabricates no native API;
6. Python preserves exact `BaseException` identity and observation-unavailable
   still reaches close/reopen/finalized;
7. poison creates no DROP or other cleanup mutation authority;
8. route/file/stage inventory has zero unknown callsites;
9. bounded-stop reuses exact P9 failure authority and presents no COMMIT;
10. all four adoption fault points are failure-atomic and leak no usable
    partial authority.

Additional hostile matrices cover missing/clone/proxy/subclass/replay/cross-
owner/cross-connection authorities, wrong phase/predecessor/ordinal, handle use
after return or consumption, cancellation ordering, source/catalog/SQL/asset
drift, definition-time intrinsic substitution, GC abandonment, stale weak
callbacks, and deterministic object-ID collision.

Every native failure boundary records commit 0, rollback <=1, close <=1, and
reopen <=1. Focused tests use real file-backed SQLite for N=0/1/3; provider/model
tests remain deterministic and offline.

## 11. Cross-runtime and privacy evidence

Normalized parity includes case ID, attempted/highest stage, accepted prefix,
third-consumed flag, phase order, per-scope issue/enter/return/retire/postflight/
consume/fail counts, ordered route IDs and trusted digests, begin/current
watermarks and deltas, N/root/identity evidence, R11/R12/clock counts, I/O
vector, cleanup classification, claims, and nonclaims.

P11-A normalized reports label the reusable cases as shapes, carry
`dynamicCountProvenance=false` in every case and the portable envelope, and
list `dynamic-count-provenance` as a nonclaim. The exact migration count-20
descriptor shape is portable evidence, but it is not native SQL execution.

Runtime-local evidence retains TypeScript iterator-return/lexical-release and
Python cursor-close counts. Exact JSON key/order/value parity is required only
for portable fields. A TypeScript parity test launches the Python reporter;
missing Python/uv or a skip is failure, not a pass.

Private registries use weak identity buckets without reverse strong roots.
Definition-time captured weak callbacks remove an entry only if bucket and
reference identity still match. Forced GC after success teardown, poison,
owner abandonment, and dropped scopes/permits must not delete a newer object
that reuses an integer ID. Public snapshots and distributions must not reveal
private authorities, absolute paths, SQL handles, prompts, telemetry, or mutable
state.

## 12. Validation checklist

At minimum, a fixture validator must reject:

- malformed JSON, duplicate route/stage IDs, duplicate stage ordinals, broken
  predecessors, noncontinuous accepted prefixes, and overlapping slice claims;
- a route with no classification, a native callsite missing from source
  inventory, an unknown SQL/digest/parameter source, or a mutation route with no
  explicit resource model;
- migration statement count other than 20;
- deletion or drift of any of the six supported descriptor `countPolicy`
  objects, singleton counts other than 1, migration count other than 20,
  baseline-entry bounds other than 0..1024, or a fake-zero completion claim
  before an exact retained-projection/count receipt;
- B2 EQP count other than 15 or R12 EQP count other than 3;
- child-owned next-ordinal before retirement, reusable prepare other than one,
  missing parent retirement, or a zero route that skips prepare/postflight;
- a fixed read missing terminal observation or resource retirement;
- stage 18 true, third evidence consumed, any COMMIT presentation/attempt, any
  accepted stage above 17, or any P11 post-stage-17 claim;
- Python non-`BaseException`-exact capture, observation-unavailable early return,
  post-poison DROP, or bounded-stop using a different rollback authority.

Recommended local structural checks for these three artifacts are JSON parsing,
64-hex validation for every SQL digest, unique/ordered EQP IDs, exact 15/3 EQP
array lengths, 30 unique stage ordinals, predecessor continuity, and slice
prefix reconstruction. Runtime acceptance additionally requires focused TS and
Python tests, cross-runtime reporter parity, typecheck/build, Ruff/mypy, complete
SQLite regression, conformance fixture validation, and an independent H0/M0/L0
review.

Until those implementation and verification gates pass, this specification is
an executable design boundary only. It must not be cited as P11 completion.
