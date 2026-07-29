# SQLite Cursor B3 authority-bridge development log — 2026-07-29

## Scope

This log begins the runtime `B3-AUTHORITY-BRIDGE` tranche after contract-freeze
commit `ee35fa19dc5b1636eed39d3a6d813070b824acec`. It does not claim rebind,
rules 11/12, migration `0002`, v2 activation, TEMP retirement, commit, release
or production throughput.

## Parallel design review

Three read-only agents independently inspected TypeScript, Python and shared
hostile boundaries. They agreed that the existing mutable transaction epoch
cannot identify a stable `BEGIN EXCLUSIVE` lineage because authorized DDL
advances it. Python's public clean outcome is directly constructible and cannot
serve as authority. Both runtimes must hand off the real private B2 transfer
before outer writes and must use opaque WeakMap/registry capabilities.

The review also found that initial stage adoption lacked literal exact-once,
all-or-nothing receipt consumption. The canonical fixture was tightened to 83
hostile obligations and digest
`b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`
before adoption implementation began.

## TypeScript first increment

The main lane added an object-identity transaction-lineage token to the private
connection snapshot, separate from the mutable owner epoch. It began a
package-private clock-authority module with opaque provider-clock source,
migration-lock capability, four-boundary capability, chained evidence receipts
and exact-once tombstones. The first draft incorrectly required one immutable
mutation epoch and accepted raw callback/lock values; parallel review rejected
it before integration. The revised design uses module-minted source/lock
objects, a stable transaction-lineage identity, current per-boundary mutation
epoch, exact previous receipt identity, before/after live-lock reads and
`total_changes`/owner-state side-effect checks.

Initial targeted Vitest execution is green. Full focused, package, workspace,
cross-runtime and independent severity gates remain pending; this is an active
implementation candidate, not an accepted milestone.

## Python parity increment

Python now has the same package-private four-boundary clock state machine and a
separate transaction-generation identity on the connection owner. Its opaque,
weak-referenceable source, lock, clock, evidence and tombstone objects keep all
authority state in private weak registries. Hostile non-weak-referenceable
objects are treated as absent authority rather than leaking raw weakref errors.
The initial parity suite covers ordered chained evidence, exact consumers,
exact-once replay rejection, DDL lineage stability, rollback/rebegin
invalidation, clone/substitution, regression, invalid clock, strict expiry,
lock drift and callback mutation.

The first strict Python gates passed Ruff lint/format, strict mypy and 103
focused source/stage/clock tests after adding reentrancy and poisoned-retry
cases. The module is not imported by the package public initializer.

## Cross-runtime report and explicit non-publication proof

The repository now has TypeScript and Python report programs plus a Node parity
gate. Seven cases compare case ID, normalized outcome, successful observation
count, consumed receipt count, provider-clock read count, `total_changes`
delta, cursor-rebind prepare count, cursor-rebind execute count and commit
count. The reports agree exactly; the three publication counters are zero for
every case and public-export flags are false. A source gate rejects the fixed
cursor UPDATE and transaction-finalization path from both clock modules.

## Independent hostile review and remediation

Executable review found three merge-blocking state-machine defects before
commit:

1. any multi-statement TypeScript DDL rotated transaction lineage, so frozen
   `0002` could not reach the second clock boundary;
2. a reentrant provider callback could mint two receipts for the same first
   boundary; and
3. a callback side effect was detected but did not burn the capability, so a
   second call could accept the already-mutated transaction.

Review also found incomplete `immediate()` lineage lifecycle, raw TypeError
leakage for null hostile lock shapes, and Trigger-body `BEGIN`/`END` false
positives. The candidate was rejected and repaired rather than committed.

The owner now distinguishes real owner transaction control from normal
multi-statement DDL, ignores comments/quotes and Trigger bodies, preserves the
same identity across the exact repository `0002`, and mints/clears lineage for
`immediate()` success and rollback. Failed multi-statement transaction starts
are reconciled to a non-null unknown-mode lineage while SQLite remains in the
transaction. Lock input capture uses captured own-data-property descriptors
and translates null, undefined, accessors and throwing Proxy traps.

Clock observation now enters a one-way `observing` state before the callback.
Reentrancy poisons the capability even if the callback swallows the nested
error. Provider failure or any validation failure after invocation also
poisons it. Side-effect and reentrancy tests prove that retry neither invokes
the clock again nor mints evidence.

## Current verified evidence

- B3 contract: 19/19 tests, validator 23 stages / 83 hostile obligations,
  digest `b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`,
  implementation and active-manifest claims false.
- TypeScript clock/connection/stage focused gate: 62/62 plus build/typecheck.
- Python clock/source/stage-ownership focused gate: 103/103 plus Ruff and
  strict mypy.
- Cross-runtime clock parity and no-publication gate: 2/2.
- Workspace lint and workspace typecheck: all eight packages passed.
- Master plan integrity: its complete HEAD byte prefix is unchanged and the
  current diff is 148 additions / 0 deletions at true EOF.

One saturated full SQLite run overlapped the full Python suite and two review
processes; 837/841 tests passed while four established large-vector tests hit
their default five-second timeout. There was no assertion mismatch. The full
SQLite suite must be rerun serially with a deterministic 30-second timeout
after the competing processes finish. Final independent severity-zero review
and milestone acceptance therefore remain pending.

## Serial full-regression and review closure

The uncontended SQLite rerun used one worker and a 30-second per-test timeout.
All 23 files and all 845 tests passed in 403.35 seconds, including every large
constant-memory source/reconciliation vector that timed out under artificial
parallel saturation. The complete Python suite passed 2,248/2,248; the latest
clock-only additions separately passed 12/12 after that long-lived process had
collected its test set.

Final workspace evidence also passed: eight-package lint/typecheck, 79 JSON
fixtures and 38 case manifests, 288 local documentation links, B3 contract
19/19, clock parity/no-publication 2/2, dual Ruff format configurations, Ruff
lint, strict mypy and `git diff --check`.

Three independent final review lanes examined the repaired candidate. The
strict state-machine and evidence lanes reported HIGH 0 / MEDIUM 0 / LOW 0.
The ordinary release-quality lane initially reported two LOW presentation
items: one ternary indentation mismatch and this log's intentionally stale
pre-rerun checkpoint. The indentation was normalized and this append-only
closure records the completed evidence. No implementation, contract or public
API finding remains open.

The clock tranche still makes no runtime claim for outer B2 transfer adoption,
migration `0002` publication, permanent cursor rebind, rule 11/12, TEMP
retirement, commit, v2 activation or release. Those remain later B3 leaves.
