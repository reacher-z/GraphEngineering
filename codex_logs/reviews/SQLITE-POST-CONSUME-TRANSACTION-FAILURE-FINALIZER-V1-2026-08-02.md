# SQLite post-consume transaction failure finalizer v1

Date: 2026-08-02 PDT
Branch: `feat/authoring-foundation`

## Accepted slice

This change adds a package-private, failure-only finalizer for an authenticated
native Rule 11 primary after exact session consume T. It terminalizes a one-shot
owner, performs one real rollback, performs one real close even after rollback
failure, enters a finalized state, and rethrows the exact leaf primary.

It does not own BEGIN, COMMIT, Rule 12, TEMP retirement, any success path or the
public workflow integration point.

## Canonical contract

- Strict schema, three-case fixture, standalone validator and 10 tests.
- Independent trusted fixture root prevents synchronized identity/digest edits.
- Lifecycle is exactly `prepared -> finalizing -> finalized`.
- Precedence is primary, rollback secondary, close tertiary.
- Cleanup injection is honestly named after-native-return ambiguity and never
  claimed as a driver-native throw.
- Canonical diagnostics exclude driver messages, addresses and timestamps.

Independent contract audit: H0/M0/L0.

## TypeScript

- Capture accepts only exact authentic S and invokes a definition-time fixed
  Rule 11 leaf internally; no caller primary, thunk or callback exists.
- Post-failure graph authentication binds connection, lineage, epoch, authority,
  context, T and E at the native execute-failure boundary.
- WeakMap/WeakRef state does not reverse-root the graph or primary.
- Real rollback and captured base close run once; snapshots contain only pure
  canonical counts, trace and diagnostics.
- Real file reopen proves pre-rebind recovery; old graph remains poisoned and a
  fresh graph is healthy.

Final independent audit: H0/M0/L0. Final target: 10/10; isolated GC: 11/11;
Rule11 regression: 20/20.

## Python

- A definition-time factory closure fixes the original Rule 11 leaf and capture
  implementation; mutable `_LEAF` rebinding cannot replace the primary.
- Exact E, adoption absence, exclusive generation/epoch and native-boundary
  counters are authenticated before owner mint.
- Registry values contain only IDs and weak references. The opaque owner is the
  only strong presentation, and all seven presentation slots are cleared after
  finalization.
- Context reverse ownership is exact and stale-callback safe.
- Three lifecycle states, all cleanup counts and ordered diagnostics match the
  same canonical fixture as TypeScript.
- Disk reopen and fresh graph recovery are real.

Final independent audit: H0/M0/L0. Final target: 16/16; subprotocol regression:
60 passed and 1 expected bounded-id-reuse skip.

## Main-thread verification

- Contract tests: 10/10.
- Standalone trusted validator: passed.
- TypeScript typecheck: passed.
- Python Ruff format/check and mypy: passed.
- TypeScript finalizer: 10/10 in about 25.25 seconds.
- Python finalizer: 16/16 in about 83.88 seconds.
- `git diff --check`: passed.

## Remaining nonclaims

The modules are package-private and not yet wired into a public production
workflow or release gate. Cross-runtime reporter byte parity, serialized changes
primary finalization, complete counter combinations, success transaction
ownership, driver-native cleanup throws, Rule 12 and the third clock remain open.
