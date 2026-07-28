# SQLite Cursor Slice B TypeScript final correction audit

Date: 2026-07-28
Reviewer role: independent correction auditor
Change policy: review only; no implementation, test, plan, daily log, registry,
staging or commit changes

## Scope and authority

This audit independently rechecked the corrected TypeScript captured-source
connection fence in:

- `packages/sqlite/src/sqlite-connection.ts`;
- `packages/sqlite/src/operation-baseline-source.ts`;
- `packages/sqlite/src/operation-baseline-cursor-ownership.ts`; and
- `packages/sqlite/test/operation-baseline-cursor-source-provenance.test.ts`.

The acceptance baseline was the original cross-runtime severity audit findings
H1, M2 and L1 in
`SQLITE-CURSOR-SLICE-B-CROSS-RUNTIME-SEVERITY-AUDIT-2026-07-28.md`, together
with the independent Claude cleanup findings in
`/home/nick/.claude/plans/you-are-an-independent-fluffy-sparrow.md`.

## Final disposition

**HIGH 0 / MEDIUM 1 / LOW 1.**

The corrected **pre-cursor-TEMP connection fence itself is accepted**: the
previous HIGH hostile-getter epoch bypass is closed, the real predecessor and
change-counter regression now exists, no package-root leak was found, and the
seven focused threat cases pass. The remaining MEDIUM is the already-identified
next-phase ownership-transfer gate: it must be closed before any cursor TEMP
DDL is implemented. The LOW is residual dead/tautological evidence and does
not provide an acceptance bypass.

## Closed findings

### Original HIGH H1 — closed

The connection module now owns a module-private symbol method that reads the
base class's `#database`, `#closed`, `#transactionMode` and
`#transactionEpoch` fields directly. The exported-to-package wrapper captures
the exact base-class intrinsic at module evaluation and invokes it with
`Reflect.apply`. Consequently:

- a subclass override of `transactionEpoch` is not called;
- a later prototype replacement cannot substitute the captured intrinsic;
- a proxy or non-branded receiver cannot impersonate the base instance;
- the snapshot rejects a closed owner;
- the snapshot compares transaction state and private epoch before and after
  its synchronous observation; and
- the source fence takes two complete private snapshots and requires both to
  retain the captured EXCLUSIVE epoch.

The initial connection fence repeats the complete source/private-owner proof
immediately before registering and publishing the opaque witness. The retained
witness path reruns A2b first and then the same source/private-owner proof.

I reproduced the original hostile shape by executing the focused regression's
real `RacingConnection extends SQLiteConnection`. With the hostile getter
armed while the real private epoch was still current, a fresh fence completed
without invoking the override: its hostile-read count did not change and it
did not execute the getter's epoch-mutating PRAGMA. I then invoked the hostile
getter directly; it returned the old epoch while a prepared
`PRAGMA schema_version` advanced the base class's real private epoch by one.
After that already-completed mutation, both fresh witness creation and
revalidation of the previously retained witness rejected with the captured
transaction error. This closes both publication and retained-witness variants
of the original H1.

### Original LOW L1 / Claude live-lifecycle M2 — closed

The seventh focused test now constructs the accepted real predecessor chain:

1. configure bounded FILE-backed baseline TEMP storage;
2. enter a real EXCLUSIVE owner transaction;
3. create the baseline TEMP stage;
4. capture the source after stage creation;
5. stage the cooperative source/relation handoff;
6. read the ordered projection; and
7. complete the stream/record, checkpoint, lease/lock/hold and legacy
   invariant campaigns with empty diagnostics.

It freezes the relevant ownership split with observable evidence:

- the real private transaction epoch is unchanged from capture through all
  predecessor campaigns;
- live `total_changes()` is greater than its capture-time value;
- the captured-source connection fence still accepts;
- an additional unexplained TEMP DML remains intentionally outside the source
  fence and therefore does not make that fence fail; and
- the adjacent stage fence rejects that unexplained write-counter drift.

This is the correct separation. The source fence must not compare historical
`total_changes()`; current write allowance belongs to the exact baseline stage.

### Claude H1/M3 pre-publication and TOCTOU correction — closed

The source assertion performs two private snapshot calls. The initial
A2b/connection entry point performs the whole source assertion twice, with the
second call adjacent to witness registration. The corrected behavior is thus
strictly stronger than merely calling the original overridable getter twice.

### Claude L3 package-root leak coverage — no leak found

Static inspection confirms `packages/sqlite/src/index.ts` re-exports none of
the connection-fence functions, source assertion, owner-snapshot wrapper or
new types. `packages/sqlite/package.json` exposes only the package root, so
published deep `dist` subpaths are not exported. The focused test has runtime
negative checks for the three functions and the snapshot wrapper.

The runtime `Object.keys` checks for interface names are necessarily
tautological because TypeScript interfaces erase, but the static index and
package-export inspection supplies the actual type/export evidence. No public
package-root leak exists in this revision.

### Claude write-only registry cleanup — substantially closed

The unused `CURSOR_SOURCE_PROVENANCE` registry and the unused
`ConnectionProvenanceState.sourceProvenance` field are gone. Exact clock and
source-envelope identity are no longer claimed as separate connection-registry
evidence; they remain owned by the A2b object-graph proof that runs first.

## Remaining finding

### MEDIUM M1 — the one-way source-to-stage owner transfer still does not exist

The historical source assertion permanently requires the current private
transaction epoch to equal the capture epoch. That is correct through the
implemented baseline stage/handoff/campaign lifecycle, as the integrated test
now proves. It cannot remain the live epoch fence after the first legitimate
cursor-specific `CREATE TEMP ...`, because `execTrusted` advances the owner
epoch before executing that DDL.

No current TypeScript API atomically binds the exact receipt, source,
projection, connection, completed predecessor state, exact baseline stage,
current stage epoch and current allowed change counter and then transfers
authority to a cursor-stage owner. The repository search found only the
historical captured-source witness and the existing baseline stage's private
`allowedTotalChanges`; there is no cursor-stage epoch adoption path.

The comment above
`assertSQLiteCursorPreRebindConnectionProvenanceWitness` still says to
revalidate the retained pre-TEMP witness "at every subsequent owner boundary."
Read without the lane log, this can be taken to include post-DDL boundaries,
where the function must fail forever. Its enforceable scope is only the
pre-TEMP boundaries up to the atomic B0 transfer.

Required before B1:

1. while the historical capture epoch still matches, atomically prove A2b,
   exact captured source/connection/projection, predecessor completion, exact
   stage identity and `allowedTotalChanges == live total_changes()`;
2. mint an exact module-owned cursor-stage capability that freezes that
   transfer state;
3. permit only the explicitly expected epoch transition for each owned cursor
   DDL boundary;
4. continue proving immutable source and receipt identity without rewriting
   the historical capture epoch; and
5. narrow the current witness documentation to its actual pre-transfer
   lifetime.

This is not an exploit in the accepted pre-TEMP source fence. It remains a
MEDIUM forward-contract gate because implementing cursor DDL without it would
either make legitimate revalidation impossible or tempt a caller to weaken or
rewrite historical evidence.

### LOW L1 — residual tautological/dead evidence

No security bypass results, but a small amount of evidence remains redundant:

- `SQLiteV1BaselineCapturedSourceState.sourceSummary` always equals its
  `WeakMap` key; checking it against the lookup argument cannot fail without a
  private module bug. Exact summary identity is already established by the
  successful key lookup.
- `SQLiteConnectionOwnerSnapshot.isOpen` is always the literal `true` because
  the snapshot throws when closed, and neither current consumer reads the
  property.
- once `state.receipt === receipt` passes, both retained and fresh receipt
  witnesses are derived from the same immutable private receipt entry. The
  subsequent selected-field comparisons are therefore defensive but
  tautological, and they still do not enumerate the complete binding. Exact
  receipt identity is the real ownership proof.
- runtime negative assertions for erased interface names cannot detect a type
  re-export; static inspection is required and currently supplies that proof.

These should be simplified or documented as defensive consistency checks in a
later cleanup. They do not alter the H1 or ownership-transfer conclusions.

## Receipt-first and failure-order review

The initial entry point invokes
`assertSQLiteCursorPreRebindReceiptProvenance(receipt)` before the captured
source registry or owner snapshot. The retained-witness entry point repeats
the receipt fence before looking up the presented witness and before touching
connection state. The closed-connection/forged-receipt test therefore observes
the receipt-provenance error rather than a closed-owner error. This ordering is
correct and was not weakened by the private snapshot correction.

## Verification evidence

Commands executed from the repository root:

```text
corepack pnpm -C packages/sqlite exec vitest run \
  test/operation-baseline-cursor-source-provenance.test.ts
  Test Files 1 passed (1)
  Tests 7 passed (7)

corepack pnpm -C packages/sqlite typecheck
  tsc -p tsconfig.json --noEmit
  passed

corepack pnpm -C packages/sqlite test
  Test Files 19 passed (19)
  Tests 433 passed (433)

git diff --check -- <four audited TypeScript paths>
  passed
```

The plain `pnpm` executable was not installed on `PATH`; the repository's
declared package-manager workflow ran successfully through `corepack pnpm`.

## Final acceptance statement

The TypeScript captured-source correction may be accepted as the exact
pre-cursor-TEMP connection fence: **HIGH 0** and no known acceptance bypass.
It must not be represented as completing the cursor-stage ownership protocol.
Original cross-runtime M2 remains the mandatory B0 gate, and the low-level
redundant evidence can be cleaned without changing protocol behavior.

## Final addendum — post-audit cleanup recheck

Recheck date: 2026-07-28

The tiny follow-up cleanup closes the LOW production-state finding recorded
above:

- `SQLiteV1BaselineCapturedSourceState` no longer stores the summary that is
  already proved by its exact `WeakMap` key;
- `SQLiteConnectionOwnerSnapshot` no longer returns the unused tautological
  `isOpen: true` field; closed owners still reject before a snapshot is
  returned; and
- `ConnectionProvenanceState` now retains only the exact receipt identity.
  The selected, tautological receipt-witness field comparisons and their dead
  retained snapshot are gone. A2b is still rerun first, so the fresh exact
  source is still derived only from the registered receipt before the private
  connection fence runs.

The retained-witness comment now states exactly: revalidate **until B0 performs
its one-way stage/campaign ownership transfer**. This makes the phase boundary
explicit. B0 remains mandatory future work before the first cursor TEMP DDL,
but absence of that not-yet-implemented transfer is an explicit nonclaim, not
a defect in this pre-transfer connection-fence tranche.

Post-cleanup verification:

```text
focused captured-source suite: 7 passed
SQLite TypeScript typecheck: passed
scoped git diff --check: passed
```

**Final scoped disposition for the corrected pre-transfer TypeScript tranche:
HIGH 0 / MEDIUM 0 / LOW 0.** The broader delivery gate remains unchanged: B0
must freeze exact source/stage/current-epoch/current-change ownership before B1
may execute cursor TEMP DDL, and historical capture evidence must not be
rewritten.
