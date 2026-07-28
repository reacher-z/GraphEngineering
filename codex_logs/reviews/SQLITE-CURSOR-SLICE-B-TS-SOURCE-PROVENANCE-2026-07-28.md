# SQLite Cursor Slice B TypeScript captured-source provenance review

Date: 2026-07-28
Scope: first minimal TypeScript Slice B owner fence only
Baseline: commit `79f61d7` and
`SQLITE-CURSOR-SLICE-B-DESIGN-AUDIT-2026-07-28.md`

## Result

Accepted for this minimal tranche. Final review severity is **HIGH 0 / MEDIUM
0 / LOW 0** inside the declared scope.

The implementation closes the first half of design-audit H1: an A2b receipt
can no longer be presented to the future TypeScript database campaign as proof
of a caller-constructed or equal-value source summary. A genuine capture is
registered by exact object identity in a module-private `WeakMap`, and the
connection fence accepts only the exact `SQLiteConnection`, exact retained
summary, exact retained clock object, exact retained source-envelope object and
the original active EXCLUSIVE transaction epoch.

This tranche does not close the stage half of H1. The existing stage remains
the owner of its later transaction epochs and `allowedTotalChanges`. The next
B0 tranche must retain this opaque pre-TEMP witness while it performs the
adjacent stage owner/legacy-completion/projection fence.

## Frozen call order

The package-private entry point is:

```ts
assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt)
```

Its order is fixed:

1. run `assertSQLiteCursorPreRebindReceiptProvenance(receipt)`;
2. derive the source summary and clock only from that retained A2b witness;
3. look up the exact summary in the captured-source `WeakMap`;
4. require exact connection, summary, clock and envelope object identities;
5. synchronously require an active owner-observed EXCLUSIVE transaction and
   the exact capture epoch; and
6. return an empty-own-key, frozen, null-prototype opaque witness.

The caller cannot pass a parallel summary, clock, projection or ownership
copy. A forged receipt fails before any connection getter is touched. This
preserves the master-plan invariant that A2b is verified before the first
cursor TEMP action.

The retained-witness boundary is:

```ts
assertSQLiteCursorPreRebindConnectionProvenanceWitness(
  connection,
  receipt,
  provenance,
)
```

It reruns the A2b fence first, proves the exact retained receipt/source/clock/
projection graph, and reruns the live source/connection/EXCLUSIVE/epoch fence.
A previously valid witness therefore cannot authorize a rollback/rebegin or a
different connection. The same boundary must be invoked synchronously at every
pre-TEMP owner transition until the stage takes ownership.

Neither function is exported from `packages/sqlite/src/index.ts`.

## Source registry

`captureSQLiteV1BaselineSourceSummary` now registers the final frozen summary
immediately before return. The registry state retains only:

- exact summary identity;
- exact connection identity;
- exact clock-evidence identity;
- exact source-envelope identity; and
- original transaction epoch.

The assertion returns a separate opaque witness registered in another private
`WeakMap`. The witness has no reconstructable scalar commitment and no
caller-readable connection reference.

The registry deliberately does **not** retain or compare capture-time
`total_changes()`. The accepted common/relation handoff advances that counter;
the exact current allowance belongs to `SQLiteBaselineTempStage`. Mixing a
stale capture counter into the connection fence would make a correct later
stage unverifiable. The B0 stage bridge must instead perform this source fence
adjacent to its own current `allowedTotalChanges` fence.

## Threat tests

The new suite first failed red because the connection-provenance entry point
did not exist (5/5 red), then passed green with these cases:

1. an exact real module-captured summary retained by a real A2b receipt is
   accepted and produces an opaque frozen witness;
2. a frozen equal-value clone can remain valid for the database-independent
   A2b primitive but is rejected by the database connection fence;
3. a separately constructed synthetic frozen summary can remain valid for
   pure A2b but is rejected because it has no captured-source registry entry;
4. a genuine summary/receipt presented to another live EXCLUSIVE connection is
   rejected;
5. rollback followed by a fresh EXCLUSIVE begin invalidates both a new fence
   attempt and revalidation of a previously accepted opaque witness;
6. repeated stale-witness calls remain rejected and cannot consume or refresh
   ownership; and
7. a forged receipt against a closed connection proves A2b is evaluated first
   by returning the receipt-provenance failure rather than touching the closed
   connection.

The suite also proves the connection fence is absent from the package-root
exports.

## Verification

- red evidence: new focused suite 5/5 failed before implementation because the
  connection-provenance function was absent;
- focused source/A2b/stage set: 4 files / 65 tests passed;
- complete SQLite source suite: 19 files / 431 tests passed;
- SQLite package TypeScript typecheck: passed;
- SQLite package lint/type gate: passed;
- SQLite package build: passed;
- scoped `git diff --check`: passed.

## Explicit nonclaims and remaining work

This tranche adds no SQL statement, TEMP object, cursor scan, rebind, migration
write, permanent state, diagnostic vector, registry claim or public API. It
does not prove stage identity, current stage `allowedTotalChanges`, exact legacy
completion, projection ownership at stage begin, absence of an active cursor
campaign, or any rule 1-10 outcome.

The next TypeScript B0 step must add a closed stage interface that consumes the
opaque witness, proves exact connection/projection/source-stage ownership after
legacy completion, fences the current allowed write counter, rejects a second
begin and retains the exact A2b receipt. Only after that synchronous barrier may
B1 create the private cursor TEMP catalog.

## Correction history — hostile subclass epoch bypass closure

An independent cross-runtime audit subsequently reproduced a HIGH-severity
gap in the first implementation. `SQLiteConnection` is subclassable, so a
hostile override of the public `transactionEpoch` getter could return the old
epoch while executing a real epoch-tracked `PRAGMA`. The original source fence
read that overridable getter and could therefore publish a witness after the
base class's real private epoch advanced.

The earlier H0/M0/L0 statement is superseded for the pre-correction revision.
The correction closes that H1 as follows:

1. `sqlite-connection.ts` now owns a package-private snapshot intrinsic keyed
   by a module-private symbol. It reads `#database.isTransaction`,
   `#transactionMode`, `#transactionEpoch`, `#closed` and database-open state
   directly under the base class private brand.
2. The exported-to-package-only wrapper invokes a captured copy of the exact
   base-class intrinsic with `Reflect.apply`. A subclass override, prototype
   replacement or public getter cannot intercept the observation.
3. The intrinsic reads the real transaction state and epoch before and after
   its synchronous observation and rejects any internal instability.
4. The source fence performs two private snapshots and requires both to be the
   same captured EXCLUSIVE epoch.
5. The initial A2b/connection fence repeats the full source/private-owner fence
   immediately before registering and publishing its opaque witness.
6. Retained-witness revalidation uses the same private snapshot path.

The hostile regression uses an exact captured `RacingConnection extends
SQLiteConnection`. Its overridden getter returns the old epoch while executing
`prepare("PRAGMA schema_version").get()`, advancing the real base-class epoch.
The corrected fence does not call the override while state is stable; once the
attack has advanced the private epoch, both fresh witness creation and the
previously accepted retained witness reject it.

## Correction history — integrated owner and evidence cleanup

The TypeScript lane now also retains the complete real predecessor lifecycle:

- bounded FILE-backed baseline TEMP profile and catalog;
- source capture after baseline TEMP creation;
- cooperative source/relation handoff;
- ordered projection;
- clean stream/record, checkpoint, lease/lock/hold and legacy campaigns;
- unchanged capture epoch through legacy completion; and
- advanced `total_changes()` owned by the stage.

The integrated test proves that the source fence remains valid after those
owned writes. It then performs one unexplained no-op TEMP DML: source
provenance deliberately remains valid because it does not own the historical
change counter, while the adjacent stage fence rejects the live counter drift.

The write-only `CURSOR_SOURCE_PROVENANCE` registry and its unused retained
`sourceProvenance` field were removed. The captured-summary registry now owns
only exact summary identity, exact connection identity and captured epoch.
Exact clock/source-envelope ownership is not claimed twice: it is provided by
the A2b retained object-graph fence that always runs first.

Package-root negative checks now cover both connection-witness functions, the
source assertion, the connection snapshot wrapper and the runtime names of the
opaque witness/snapshot types. None is re-exported by `index.ts`.

Post-correction evidence:

- focused captured-source suite: 7/7;
- integrated source/A2b/connection/reconciliation selection: passed;
- complete SQLite source suite: 19 files / 433 tests passed;
- SQLite typecheck, lint/type gate and build: passed;
- scoped `git diff --check`: passed.

Local post-correction TypeScript disposition is **HIGH 0 / MEDIUM 0 / LOW 0**
for the declared pre-cursor-TEMP connection-fence tranche. The separate B0
one-way transfer remains required before cursor TEMP DDL: B0 must freeze exact
receipt/source/projection/stage/current-epoch/current-allowed-change ownership,
then the stage may adopt only its own expected cursor-DDL epoch transitions.
Historical capture evidence must never be rewritten.

## Correction history — minimal pre-transfer witness state

A final scoped cleanup narrows this tranche to precisely the state it owns:

1. The captured-summary `WeakMap` no longer duplicates the exact summary in
   its value. Exact identity is already enforced by the weak key; the value
   retains only the exact connection and immutable capture epoch.
2. The connection-owner snapshot no longer returns the constant `isOpen: true`
   field. Closed owners still fail before publication; consumers require only
   transaction state, mode and epoch.
3. A connection-provenance witness now retains only its exact A2b receipt.
   Revalidation always executes the complete A2b receipt provenance check
   first, requires exact receipt identity, then re-runs the source/private
   connection fence. Retaining and comparing an arbitrary subset of the same
   freshly validated receipt object graph added neither coverage nor clarity.
4. Its lifecycle comment now ends explicitly at the B0 one-way stage/campaign
   transfer boundary. This witness is not intended to remain authoritative
   after the next owner adopts the current stage epoch and allowed-write fence.
5. Package-root tests retain negative checks for every real runtime function.
   Checks for erased TypeScript interface names were removed because those
   names cannot exist in the runtime module namespace regardless of exports.

This cleanup changes no public API and does not implement B0.
