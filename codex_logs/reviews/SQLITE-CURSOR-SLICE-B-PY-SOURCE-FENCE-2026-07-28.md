# SQLite Cursor Slice B Python captured-source connection fence

Date: 2026-07-28

Scope: the first package-private Python Slice B ownership bridge after A2b.
This tranche changes only the Python source-capture provenance primitive, the
new cursor source/connection fence, and its focused tests. It creates no cursor
TEMP object, issues no cursor SQL, starts no rebind, changes no registry claim,
and does not claim Slice B completion.

## Acceptance result

Accepted for the next B0 integration tranche with **H0 / M0 / L0** open
findings in this bounded scope.

The accepted call surface is:

```python
_assert_sqlite_cursor_captured_source_connection_provenance(connection, receipt)
```

The A2b receipt is the sole explicit source/projection/session context. The
function first executes the existing non-consuming A2b provenance fence and
only then derives the retained source summary and clock evidence. It does not
accept caller-supplied copies of either value.

## Provenance construction

`capture_sqlite_v1_baseline_source_summary` now registers its exact returned
summary identity in module-private storage. The registry is an `id` to
`weakref.ref` map because the frozen summary contains an unhashable mapping and
is therefore unsuitable as a `WeakKeyDictionary` key. Acceptance requires both
the original integer identity and `reference() is summary`; the weakref cleanup
callback removes only its own still-current reference, preventing both strong
retention and a stale callback from deleting a later entry.

The registration happens only after the complete capture and final transaction
assertion succeed. Direct dataclass construction, `dataclasses.replace`, and a
structurally equal clone therefore have the right runtime type but no authentic
module-capture identity and are rejected. Focused tests mint otherwise valid
A2b receipts around both hostile summary forms using the same live connection,
clock object and transaction epoch; neither passes the new fence.

Adding `weakref_slot=True` is the only summary representation change. Frozen
field semantics, constructor fields, equality, source bytes, iteration state
and every existing protocol value are unchanged.

## Exact synchronous fence

After the A2b fence, every acceptance and witness revalidation proves:

1. the connection has the exact owner type;
2. the retained summary is the exact module-captured object in the weak
   identity registry;
3. the retained clock has the exact clock type and is the summary's exact
   `clock_evidence` object;
4. `summary._connection is connection`;
5. the connection remains in the owner-observed EXCLUSIVE transaction;
6. the source capture epoch equals the current connection epoch; and
7. a second synchronous epoch read still equals the first read.

The returned witness is a package-private frozen dataclass whose constructor is
guarded by a module token. It retains the exact receipt provenance, summary,
clock, connection and transaction epoch. `_assert_current()` repeats the A2b,
module-capture, identity, EXCLUSIVE and epoch proofs and additionally requires
that the returned object graph is the original graph. The fence invokes this
method once before publishing the witness, closing a mutation window between
the initial checks and return.

## Change-counter ownership decision

This source fence deliberately does **not** compare
`summary._source_total_changes` with the current connection count and does not
freeze a current count in its witness. The baseline TEMP stage legitimately
advances `total_changes` after source capture. Slice B's following stage-owner
fence must synchronously require
`stage._allowed_total_changes == connection.total_changes` adjacent to this
source proof. Conflating those values here would reject correct loaded stages
or make the witness stale after an owner-authorized stage write.

The focused test explicitly proves that the capture-time count is below the
completed baseline stage's allowed count and that this source-only witness does
not claim ownership of a later write-count change. This is a nonclaim, not a
weakened stage fence.

## Hostile and lifecycle evidence

The focused suite proves:

- a real exact capture and receipt are accepted and can be revalidated
  repeatedly;
- direct construction with the same private bytes, live connection, exact
  clock object, source count and epoch is rejected;
- a `dataclasses.replace` clone is rejected;
- a different live EXCLUSIVE connection is rejected;
- a PRAGMA-driven transaction epoch change is rejected;
- receipt verification occurs before the module-capture registry fence on both
  the initial check and pre-publication revalidation;
- a synthetic second epoch value between the two synchronous reads is rejected;
- direct witness construction without the module token is rejected; and
- deleting the last summary reference triggers weak registry cleanup and leaves
  no identity entry behind.

## Verification evidence

- `uv run --project python pytest -q python/tests/test_sqlite_operation_baseline_cursor_source_fence.py`
  — **9 passed**.
- Related SQLite source/stage/cooperation/handoff/cursor suite — **219 passed**.
- `uv run --project python pytest -q` — **1758 passed, 2 subtests passed**.
- `uv run --project python ruff check python/src python/tests` — passed.
- Scoped `ruff format --check` over all three changed Python files — passed.
- `uv run --project python mypy --strict python/src/graph_engineering` —
  **50 source files, no issues**.
- `git diff --check` over the implementation scope — passed.

The repository-wide format check reports forty older, unrelated files that
would be reformatted. None is in this tranche, and no broad formatter was run,
preserving parallel-lane ownership.

## Explicit nonclaims and next gate

This tranche does not prove the existing baseline stage is the exact stage
bound to the retained projection, does not prove its allowed change counter,
does not require legacy completion, does not create the cursor TEMP catalog,
does not scan `main.ge_cycle_cursors`, does not execute rules 1-10, and does not
consume the A2b receipt.

The next B0 owner wrapper must accept the connection, exact baseline stage and
A2b receipt; call this source fence; immediately prove exact stage connection,
summary, projection, completed legacy campaign, open state, captured/live/stage
epoch and `stage._allowed_total_changes == connection.total_changes`; re-run
both fences around every subsequent owned boundary; and still reject before
the first cursor TEMP DDL on any mismatch.

## Correction history — exact witness identity and closed-owner vocabulary

Post-review date: 2026-07-28

The original acceptance text above called the frozen token-guarded dataclass
an opaque module-minted witness and said it retained the original object graph.
That statement was incomplete. `dataclasses.replace(witness)` copied the real
token and every retained field into a distinct dataclass object, and the clone's
`_assert_current()` originally passed because no registry proved the witness's
own identity. The earlier hostile bullet about a rejected dataclass clone
referred to a cloned **source summary**, not a cloned connection witness.

This gap is now closed. The witness is weak-referenceable and uses identity
equality. Every successfully issued exact witness is registered as a key in a
module-private `WeakKeyDictionary`, whose value freezes the exact connection,
receipt provenance, source summary, clock and transaction epoch. Every
`_assert_current()` now performs these checks in order:

1. run the non-consuming A2b receipt provenance fence;
2. require `type(witness)` to be the exact private witness type;
3. require this exact object to be present in the weak identity registry;
4. require every registered object reference and epoch to equal its retained
   witness field; and
5. re-prove exact captured summary, clock, connection, EXCLUSIVE mode and the
   double-read transaction epoch fence.

Registration occurs immediately before the pre-publication `_assert_current()`
call. A failed pre-publication proof removes that entry synchronously. A
successful witness is not retained by the registry and disappears from it when
the last external reference is released.

New hostile tests prove that all of the following distinct objects fail their
own `_assert_current()` while the original witness remains valid:

- `dataclasses.replace(witness)` with the copied real token;
- `copy.copy(witness)` with the copied real token and state; and
- a direct exact-type constructor supplied every real retained field and the
  original witness's actual construction token.

The witness now has identity equality, so these clones are also unequal to the
registered original. A weak-lifecycle test proves registry insertion and
automatic cleanup without retaining the witness.

A second review found that a closed exact Python connection could leak
`sqlite3.ProgrammingError` while reading `in_exclusive_transaction`. The live
owner observations are now enclosed by the private fence and normalize any
closed/unavailable property failure to the owned deterministic `ValueError`
message `cursor captured-source connection is closed or unavailable`. Receipt
ordering remains authoritative: a forged receipt presented with the same
closed connection still fails the A2b receipt fence before any connection
property is touched; a valid receipt reaches the normalized closed-owner
failure without exposing `sqlite3.ProgrammingError`.

The correction deliberately adds no `total_changes` read or comparison. Stage
allowed-change ownership and the later capture-epoch-to-owned-DDL transfer
remain the explicit next B0 responsibilities described above.

Post-correction verification:

- focused cursor source-fence suite: **13 passed**;
- related SQLite source/stage/cooperation/handoff/cursor suite: **224 passed**;
- complete Python suite: **1762 passed, 2 subtests passed**;
- full Python Ruff lint: passed;
- scoped Ruff format check for the three Python implementation/test files:
  passed;
- strict MyPy: **50 source files, no issues**; and
- scoped whitespace/diff checks: passed.

Post-correction scoped disposition: **HIGH 0 / MEDIUM 0 / LOW 0** for exact
Python witness identity and the closed-owner error boundary. This disposition
does not close the cross-runtime TypeScript epoch finding or the future B0
epoch-transfer/stage-fence work.
