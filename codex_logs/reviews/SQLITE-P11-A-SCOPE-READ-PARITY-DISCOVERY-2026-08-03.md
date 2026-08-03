# SQLite P11-A scope/read parity and discovery review

Disposition: **ACCEPT AS A BOUNDED ZERO-I/O P11-A PARITY TRANCHE — H0 / M0 / L0**.

Date: 2026-08-03 PDT

This review does not accept complete P11-A, P11-B/C/D, native route closure,
runtime-real resource retirement, D9 completion, release readiness, or an
external adoption/stars outcome. It accepts only the hardened zero-I/O
scope/read authority lattice, count-policy contract, normalized parity, and
conservative callsite-discovery tool described below.

## Accepted scope

- Six exact mutation descriptors with route-bound count policy:
  migration `20`; four singleton routes `1`; baseline entries bounded shape
  `0..1024` with future exact-count provenance explicitly required.
- TypeScript mutation parent/child and fixed-read transitions with direct
  native-current drift, lineage/generation replacement, hostile intrinsic, and
  forced-GC regressions.
- Independent Python mutation parent/child and fixed-read state machines with
  exact P9 reproof at every lookup/transition and exact-primary cleanup.
- Definition-time object intrinsic capture in Python composition and the P9
  owner finalizer.
- Portable TypeScript/Python zero-I/O parity with runtime-local resource-kind
  evidence kept outside portable equality.
- A deterministic, conservative TS/Python AST callsite scanner whose output
  remains an open work inventory and never claims route closure.

## Rejected-first findings and closure

The callsite scanner first received H1 because a method named `prepare` or
`execute` could upgrade an unknown lower receiver to a proven statement/cursor.
An exact known SQL literal could therefore be misclassified. The repaired
scanner propagates, but never upgrades, receiver confidence. Hostile exact-SQL
unknown receivers stay unknown in both languages.

The runtime lattice then received H1 because caller-supplied counts were only
generically bounded. `main.migration-0002` could complete with zero and a
singleton DDL route could complete with two. Exact descriptor identity now
selects exact `20`, exact `1`, or the sole bounded-dynamic baseline shape.
Wrong counts terminally fail before mutation I/O and use exact P9 cleanup.

The Python lattice received a second H1 because token slots could be rewritten
with base `object.__setattr__`; presentation mismatch then raised locally while
the transaction owner remained active. Ordinary and base-object mutation now
recover authority from exact registry records and terminalize through P9.
Composition cleanup no longer trusts token attributes.

The initial Python repair still left P9 finalizer object access dynamically
resolved. A hostile replacement of `builtins.object` could fault secondary
cleanup and leave an active transaction. P9 now mechanically captures object
get/set intrinsics at definition time. The hostile class raises sentinels for
get/set/del, yet the selected order failure retains its exact primary and
rollback/close/reopen remain `1/1/1` with COMMIT zero.

An integration audit also found that the root runtime script invoked bare
`pnpm`, which failed in the repository's corepack-only local environment. The
entrypoint now consistently invokes `corepack pnpm`.

## Machine contract evidence

- Contract validator: 6/6 passed.
- Supported mutation descriptor count: 6.
- B2 EQP count: 15; Rule12 EQP count: 3; inventories remain disjoint.
- Hostile policy mutations reject missing/drifted singleton, migration,
  bounded-dynamic, provenance, and fake-zero fields.
- Route closure remains false and actual unclassified native callsite count in
  the authoritative fixture remains null.

## Runtime and parity evidence

- Root `test:sqlite-owner-composition-runtime`: passed.
- TypeScript typecheck: passed.
- TypeScript P11 focused: 70/70 passed.
- TypeScript P9 affected: 26 passed, 1 environment-conditional skip.
- Python P11 focused: 73/73 passed.
- Python P9: 36/36 passed; P9+P11: 109/109 passed.
- Python P10 Rule12: 41/41 passed.
- Forced cross-runtime P11 parity: 3/3 passed.
- Python reporter produced one canonical JSON line; two executions were
  byte-identical at 4,574 bytes.
- Ruff and mypy: passed. `git diff --check`: passed.

The portable report contains `child-owned-20`, `reusable-shape-0/3`,
`fixed-read-0/2`, and one mutation-order cleanup case. Every case preserves
`actualNativeIoCount=0`, `sqlAuthority=false`,
`dynamicCountProvenance=false`, `routeClosure=false`,
`stage18Accepted=false`, and `commitAttemptCount=0`.

## Discovery evidence

The production scan is byte deterministic across two executions and covers 70
files: 43 TypeScript and 27 Python. It records 457 candidates, including 343
with exact SQL evidence. Candidate operation classes are 227 read, 82 mutation,
33 transaction/forbidden, and 115 other unknown.

All 457 candidates remain `routeClassification=unknown`; the fixture supplies
one digest candidate but authorizes zero callsites. This is intentional. The
scanner cannot convert receiver-name heuristics, interpolation, computed
methods, unresolved prepared lineage, cross-file aliases, or unregistered
digests into authority. Scanner hostile tests: 3/3 passed.

## Required nonclaims

No P11 mutation or fixed-read token executes native SQL. No TypeScript iterator
or statement and no Python cursor is actually retired by this tranche. The
baseline entries `0..1024` value is only a state-machine shape; no retained
projection/count/root receipt proves genuine zero or N. The 457 discovery
candidates are not 457 confirmed P11 callsites, and unknown is not zero.

There is no native owner-active fixed read, lower writer hook, P11-B file-backed
B2 composition, P11-C permanent write composition, P11-D transitive
R11/Rule12/third-clock composition, third consume, stage 18, fourth clock, TEMP
retirement, final fence, success, COMMIT, public API, D9 completion, candidate
release weight, RC, stable release, or stars claim.

The immutable implementation commit SHA is intentionally recorded by the
subsequent evidence reconciliation commit after the implementation commit is
created and pushed.

## Final narrative correction audit

A final evidence-only reviewer found no runtime/spec/scanner/CI defect, but
rejected two imprecise phrases in the first appended checkpoint. Append-only
§31.37.88 now records the literal fixture shape: policy kind `"exact"`, fake-zero
as a separate acceptance assertion, and 24 transitions tested after combined
transaction/TEMP/total-change drift rather than three isolated drift campaigns.
With that append-only correction, the final whole-batch disposition is
H0/M0/L0. Isolated per-watermark fault campaigns remain future hardening.
