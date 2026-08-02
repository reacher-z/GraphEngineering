# SQLite cursor Rule 11 Wave 1E native-failure and exact-changes log

Date: 2026-08-02 PDT

Scope: two bounded advances after commit `b8f656bae9b199b027f08de27352fe3a0c12b492`:

1. real post-tombstone SQLite native UPDATE failure in both TypeScript and Python
   serialized Rule 11 leaves;
2. Python lower-source `changes()` exact-one-row production observability.

This record does not claim the complete hostile matrix, Rule 12, third-clock
completion, release readiness, or any GitHub star outcome.

## Parallel ownership

- TypeScript writer: test-support timing hook, real native abort focused test,
  sixth GC profile, affected fixture regressions.
- Python writer: real native abort/cleanup/GC test, then lower-source bounded
  `fetchmany(2)` production change and hostile result matrix.
- Independent auditor: cross-runtime coverage map plus three separate final
  H0/M0/L0 delta audits.
- Primary agent: rejected false pre-T trigger evidence, coordinated timing changes,
  reran the final exact TypeScript case and cross-runtime parity, maintained the
  append-only plan, staged/committed/pushed the accepted scope.

## TypeScript real post-T native failure

The first trigger attempts were intentionally discarded:

- installing through `execTrusted` after S advanced the transaction epoch and
  failed before T with a stale fence;
- installing after B2 sealing but before outer preparation invalidated the sealed
  B2 authority;
- installing a main-schema trigger after graph construction caused catalog/outer
  ledger drift before the native UPDATE.

The accepted test-support hook runs once, with the exact newly created connection,
after authentic cursor rows but before baseline TEMP-stage creation. It installs a
TEMP `BEFORE UPDATE` trigger with `RAISE(ABORT, ...)`. B2, outer authority, migration,
publication and S all capture the resulting legitimate epoch. The serialized leaf
then consumes T before the definition-time captured `StatementSync.run` receives
SQLite class 19.

Observed terminal state:

- original error: `GE_CYCLE_STORE_CORRUPTION`, SQLite class 19;
- E: execute=1, release=1, poisoned, statement ownership retired;
- E affected/changes/cursor-ledger progress: all zero;
- outer, P/context and T: poisoned;
- A: absent; therefore W/R11 mint control flow is unreachable;
- S active snapshot: rejected;
- transaction remains open for its actual upper fixture owner;
- disposer rolls back/closes/removes the graph;
- sixth `native-run-fault` GC profile collects graph, authority, connection,
  S, prepared owner, context, tombstone and execution.

The optional hook defaults to undefined. Callback failure is handled as a graph
construction primary: best-effort rollback/close and temporary-root removal occur
before rethrowing the original error.

## Python real post-T native failure

After minting S, the test uses the same exact underlying sqlite3 connection to
install a TEMP `BEFORE UPDATE ... RAISE(ABORT)` trigger without altering the owner
epoch or total-change accounting. The serialized leaf consumes T and the real
cursor execute fails with `GE_CURSOR_B3_CURSOR_REBIND_EXECUTE`.

An exact-connection test harness calls the real E release and then raises a
secondary `BaseException`; the original native primary still wins. E is poisoned
with execute/release=(1,1), outer/context/T are poisoned, S is dead, W/R registries
do not gain partial entries, the trigger is dropped, all tracked identities collect,
and nine registries return to their pre-test baseline.

## Python exact-one changes proof

Production now captures `sqlite3.Cursor.fetchmany` at definition time and performs
one bounded `fetchmany(2)` proof. It accepts only:

- an exact builtin list;
- exactly one element;
- an exact builtin one-element tuple;
- an exact integer in 0..MAX_SAFE_INTEGER;
- a value exactly equal to the native affected count.

The matrix rejects zero rows, two rows, tuple-as-container, string, empty/wide row,
list/tuple subclasses, hostile iterable/index/length hooks, float, bool, negative,
unsafe integer and count mismatch. Prepare/fetch/shape/value/close precedence and
the (prepare, fetch, release) counters are locked. `changes_fetch_count=1` means
one bounded proof fetch, including a fetch that raises.

## Acceptance results

- TypeScript exact native case: 1 passed, 16 skipped.
- TypeScript Rule 11 suite: 17/17 passed.
- TypeScript explicit threads `--expose-gc`: 17/17 passed.
- TypeScript shared-fixture affected regressions: 12 files, 206/206 tests passed,
  216.39 seconds.
- TypeScript scoped typecheck and diff-check: passed.
- Python post-T exact test: 1/1 passed.
- Python subprotocol full suite: 32/32 passed, approximately 106 seconds.
- Python lower rebind-source suite: 34/34 passed.
- Python Ruff, mypy and diff-check: passed.
- Cross-runtime Rule 11 parity after the Python production change: 3/3 passed;
  real deterministic/byte-exact case 55.515 seconds, total 55.639 seconds.
- TypeScript delta audit: H0/M0/L0.
- Python post-T delta audit: H0/M0/L0.
- Python exact-one lower delta audit: H0/M0/L0.

## Frozen identities

- `packages/sqlite/test/cursor-publication-rebind-rule11.test.ts`:
  `ad8ab573192bd3aa5755ac9602bd853c53cc202c0fb63190e45dd921385c13aa`
- `packages/sqlite/test/support/cursor-publication-clean-graph.ts`:
  `0814720184da62191864f7c08219cb52f4ff072e86212dd8463a4d58f4dbb937`
- `python/src/graph_engineering/sqlite_operation_baseline_source.py`:
  `cdce9d1ce89f369d546c3d917804b9793a1b0b943dfd5736757d090e06bfe651`
- `python/tests/test_sqlite_cursor_publication_rebind_source.py`:
  `b0d4cad0ed832f6d27390a2001d00d1f744637ebf8795377576159140e978ebb`
- `python/tests/test_sqlite_cursor_publication_subprotocol.py`:
  `85df5ee72ee7153941855eb4a6c6cb90632edb18feebcd339fa3dc281e4fd823`

All five files were mode 0644 at freeze time.

## Append-only proof

Before this append the master plan had 20,510 lines and SHA-256
`1bd675d0e5ab213972d32900e3d0dab333016152a9522084e5e00cc06b9b4a5f`.
That exact prefix remains unchanged. Section 31.37.69 was appended only.

## Remaining blockers before Wave 1E completion

- exact-E, selected-graph-bound pre-consume release failure;
- TypeScript raw native result and exact-one `changes()` hostile matrices;
- Python native affected-result full matrix at serialized-leaf scope;
- B2/projection/parameter and outer/cursor ledger authentic drift matrices;
- transaction-owner rollback/close precedence after T;
- honest bounded Python id-reuse observation/skip evidence.

Node `StatementSync` has no explicit native close, so TypeScript evidence must call
its behavior logical statement retirement. Existing global cleanup injection is not
exact-execution-bound and is not accepted as composite hostile evidence.
