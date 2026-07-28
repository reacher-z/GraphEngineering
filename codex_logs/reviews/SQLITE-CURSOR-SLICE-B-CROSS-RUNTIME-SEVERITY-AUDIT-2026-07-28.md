# SQLite Cursor Slice B captured-source fence cross-runtime severity audit

Date: 2026-07-28

Scope: current uncommitted captured-source fence changes only:

- `packages/sqlite/src/operation-baseline-source.ts`
- `packages/sqlite/src/operation-baseline-cursor-ownership.ts`
- `packages/sqlite/test/operation-baseline-cursor-source-provenance.test.ts`
- `python/src/graph_engineering/sqlite_operation_baseline_source.py`
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_source_fence.py`
- `python/tests/test_sqlite_operation_baseline_cursor_source_fence.py`

Design authority read:
`codex_logs/reviews/SQLITE-CURSOR-SLICE-B-DESIGN-AUDIT-2026-07-28.md`.

No implementation, test, plan, daily log, registry, or commit was changed by
this audit.

## Disposition

**Not accepted yet: HIGH 1 / MEDIUM 2 / LOW 1.**

The basic ownership graph is sound in both languages: A2b is evaluated first,
the source summary is derived only from its retained provenance, exact summary,
clock and connection identities are checked, capture-time `total_changes` is
correctly excluded, and rollback/rebegin is rejected. However, the TypeScript
fence has a demonstrated live-epoch TOCTOU bypass, the Python witness is
cloneable despite its module-minted claim, and the transition from the
capture-epoch fence to the later cursor-TEMP owner is not yet frozen in an API
that can be revalidated after owned DDL.

## Severity findings

### HIGH H1 — TypeScript accepts a witness after a hostile connection getter advances the real epoch

The captured-source lookup correctly requires exact object identity at
`operation-baseline-source.ts:1170-1174`. The mutable connection fence then
reads `isTransaction`, `transactionMode`, and `transactionEpoch` once at
lines 1181-1183. It does not require the exact base-class prototype and does
not use a connection-module-owned atomic/private snapshot.

`SQLiteConnection` is subclassable and its public accessors can be overridden.
An exact captured subclass instance can therefore return the old epoch from an
overridden `transactionEpoch` getter while executing an epoch-tracked PRAGMA.
The assertion compares the returned old value with capture state and mints the
provenance even though the connection's real private epoch has changed.

This was reproduced against the built current source with a real file-backed
database and real capture:

```text
{"accepted":true,"captured":"12","after":"13","drifted":true}
```

The attack used a `RacingConnection extends SQLiteConnection`. Once armed, its
getter read `super.transactionEpoch`, executed
`prepare('PRAGMA schema_version').get()` and returned the former value. The
prepared PRAGMA increments the real private epoch at
`sqlite-connection.ts:395-405`. `assertSQLiteV1BaselineCursorSourceProvenance`
still returned a frozen witness.

The same primitive is called by initial A2b/connection binding at
`operation-baseline-cursor-ownership.ts:518-522` and by retained-witness
revalidation at lines 557-560, so both paths inherit the bypass. Current tests
cover rollback/rebegin but do not exercise hostile subclasses, getters, or an
epoch mutation between connection observations.

Required remediation is stronger than adding a second call to an overridable
getter. The connection module should expose a package-private owner snapshot or
assertion that reads `#database.isTransaction`, `#transactionMode`, and
`#transactionEpoch` directly under the class private brand, invoked through the
unmodified imported class implementation. Alternatively, the fence must reject
non-exact prototypes and use captured intrinsic accessors plus a second epoch
read. Add an attack test that reproduces the exact accepted-12/live-13 case and
requires rejection before witness publication and during retained-witness
revalidation.

### MEDIUM M1 — Python's alleged module-minted witness is clonable by `dataclasses.replace`

The Python source summary itself has correct identity provenance: the weak
registry at `sqlite_operation_baseline_source.py:654-680` requires both the
original `id` and `reference() is summary`, and cloned summaries reject.

The later connection witness has a weaker construction boundary. It is a
frozen dataclass whose `_construction_token` is an ordinary init field at
`sqlite_operation_baseline_cursor_source_fence.py:47-61`. A caller holding one
valid witness can invoke `dataclasses.replace(witness)`. `replace` copies the
real token and every retained object, constructing a distinct object outside
the module. The clone passes `_assert_current()` because lines 63-78 validate
only its retained values, not its own identity in module-private storage.

The bypass was reproduced after the real common handoff and all predecessor
campaigns:

```text
{'distinct': True, 'equal': True, 'clone_revalidated': True}
```

The existing test at
`test_sqlite_operation_baseline_cursor_source_fence.py:106-115` checks only a
direct constructor with `object()` as the token; it does not exercise
`dataclasses.replace` or a copied real token. This differs from the accepted
Python A2b capability design, where exact identities are keys in
`WeakKeyDictionary` registries and scalar-equivalent construction is
insufficient.

This is MEDIUM rather than HIGH in the current slice because the witness does
not yet authorize TEMP creation or another side effect, and a cloner already
possesses the exact receipt and connection needed to request a legitimate
witness. It must be closed before B0 treats witness identity as an ownership
capability. Use an opaque weak-referenceable class with no copied state fields
and a module-private identity-to-state registry, or independently register the
exact dataclass object and reject unregistered clones in `_assert_current()`.
Add `replace`, direct-token-copy, equality, pickle/copy and subclass negatives.

### MEDIUM M2 — capture-epoch revalidation has no frozen ownership transfer for the first cursor TEMP DDL

The capture epoch can validly remain equal through the **already implemented**
baseline TEMP handoff and four completed invariant campaigns. The fixed TEMP
catalog is created before source capture in the accepted lifecycle. Subsequent
common/relation loads are DML and the campaigns use reads; they advance
`total_changes` but do not advance the owner epoch.

An independent TypeScript real-database probe performed the complete pristine
handoff and stream/record, checkpoint, lease/lock/hold and legacy campaigns:

```text
epochAtCapture=45
epochAfterCampaigns=45
epochEqual=true
totalChangesAtCapture=3
totalChangesAfterCampaigns=9
totalChangesAdvanced=true
allClean=true
```

Python's integrated `_prepared_fence` reaches legacy completion before minting
the witness (`test_sqlite_operation_baseline_cursor_source_fence.py:80-89`) and
then successfully revalidates it repeatedly at lines 92-105. Therefore capture
epoch equality is correct at the present pre-TEMP B0 boundary; it is not a
false failure caused by the completed predecessor campaigns.

The next cursor-specific `CREATE TEMP TABLE`, however, necessarily advances the
owner epoch: TypeScript `execTrusted` increments it at
`sqlite-connection.ts:419-423`, and Python classifies `CREATE` as epoch-mutating.
Both current source fences permanently require current epoch equal to captured
epoch. Their retained witnesses therefore cannot be re-run after the first
legitimate cursor TEMP DDL.

That is compatible only if B0 performs an explicit one-way ownership transfer:
while capture epoch still matches, it must atomically mint an exact
stage/campaign handle binding receipt, source, connection, clock, projection,
legacy-complete state, stage epoch and current allowed changes. After B1 DDL,
the stage owner may adopt only the exact expected epoch transition and must
continue revalidating source identity and A2b provenance without pretending the
live epoch still equals the historical capture epoch. The current comments say
the stage will assume later epochs, but no such transfer carrier exists yet;
the Python lane review also asks to rerun both fences around every subsequent
boundary, which is impossible after owned DDL under the current equality rule.

Do not fix this by mutating `_captured_transaction_epoch` or the registered
source state. Freeze the phase transition and its exact `before -> after`
owner evidence in the next B0 contract/tests before any cursor TEMP statement.

### LOW L1 — the TypeScript suite lacks the integrated predecessor-completion and change-counter nonownership vector

The Python focused suite creates the real baseline stage, completes the
predecessor campaigns, proves capture epoch equality, proves
`summary._source_total_changes < stage._allowed_total_changes`, and proves the
source witness deliberately ignores a later DML change
(`test_sqlite_operation_baseline_cursor_source_fence.py:92-105` and 194-207).

The TypeScript focused suite captures directly after `BEGIN EXCLUSIVE` without
creating or completing the baseline stage
(`operation-baseline-cursor-source-provenance.test.ts:108-246`). Its source code
correctly contains no `total_changes()` read in the new assertion, and the
independent integrated probe above passed, but the behavior is not retained as
a TypeScript regression. Add a parity test after real handoff and all four
campaigns that proves epoch unchanged, total changes advanced, source fence
still valid, and an adjacent forged DML delta is rejected by the stage fence
rather than owned by the source witness.

## Accepted properties

### A2b-first ordering

TypeScript initial binding calls
`assertSQLiteCursorPreRebindReceiptProvenance` before the source/connection
primitive (`operation-baseline-cursor-ownership.ts:518-522`). Revalidation
again runs A2b before looking up the presented witness or touching connection
state (lines 540-545). Its closed-connection/forged-receipt test confirms the
receipt error wins.

Python initial binding calls the receipt fence at
`sqlite_operation_baseline_cursor_source_fence.py:93` before source or
connection validation, then performs the same order again in pre-publication
`_assert_current()` at lines 66-72. The monkeypatch trace expects exactly
`["receipt", "source", "receipt", "source"]`.

### Summary, clock and connection binding

TypeScript's capture-only `WeakMap` is populated immediately before returning
the final frozen summary (`operation-baseline-source.ts:1136-1152`). Acceptance
requires exact summary, connection, clock and source-envelope identities at
lines 1170-1174. Equal frozen and synthetic summaries and another exact live
connection reject.

Python registers only a successfully captured exact summary and cleans the
weak entry without a stale callback race. The connection must have exact owner
type, the summary must be registered, the clock must have exact type and
identity, and `summary._connection is connection`
(`sqlite_operation_baseline_cursor_source_fence.py:28-43`). These checks are
correct apart from the witness-identity issue described above.

### Repeat revalidation and rollback/rebegin

Both lanes rerun non-consuming A2b provenance, source identity, clock identity,
connection identity, EXCLUSIVE mode and captured epoch. Rollback followed by a
new EXCLUSIVE transaction is rejected. Python additionally performs two epoch
reads and has a synthetic between-read regression. TypeScript requires the H1
private-owner observation fix before its repeated revalidation is trustworthy.

### `total_changes` ownership

It is correct that neither captured-source fence compares the historical
capture counter with the current counter. Existing owned common/relation writes
legitimately advance it, as the independent `3 -> 9` result proves. The source
witness alone therefore MUST NOT authorize B0 or B1: it has to be adjacent to
the existing stage's exact `allowedTotalChanges == live total_changes` fence.
An unexplained DML can pass the source-only witness by design and must fail the
stage fence. No `total_changes` ownership should be added to the source
provenance object.

## Verification evidence

Focused current suites:

```text
TypeScript source/A2b/stage: 4 files, 65/65 passed
Python source/A2b/stage: 135/135 passed
```

Independent hostile probes:

```text
TypeScript subclass/getter epoch race:
  accepted=true, captured=12, real after=13, drifted=true

Python dataclasses.replace witness clone:
  distinct=true, equal=true, clone_revalidated=true

TypeScript full predecessor lifecycle:
  capture epoch 45 == post-campaign epoch 45
  total_changes 3 -> 9
  four campaign diagnostic sets empty
  source provenance accepted
```

The package build used for the TypeScript probes completed successfully. The
focused test commands were run from the SQLite package and Python project,
respectively. No test failure explains or weakens the two hostile
reproductions; they are missing threat cases.

## Required closure order

1. Close H1 with a TypeScript connection-module-owned private state snapshot
   and exact hostile getter/subclass tests on initial and retained fences.
2. Close M1 by making the Python witness exact-identity registry-backed and add
   copy/replace/token/subclass negatives.
3. Freeze M2's one-way pre-TEMP source-to-stage ownership transfer before
   implementing cursor DDL; never rewrite capture evidence.
4. Add L1's integrated TypeScript epoch/change-counter parity regression.
5. Re-run focused, full SQLite/Python, type/lint/build, strict MyPy, diff, and
   independent cross-runtime review before accepting B0.
