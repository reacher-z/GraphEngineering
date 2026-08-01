# Python cursor B3 migration-0002 writer acceptance — 2026-08-01

## Accepted boundary

This record accepts the package-private Python writer that consumes one exact
active outer-publication authority and executes the installed migration-0002
catalog rebuild inside the caller-owned `BEGIN EXCLUSIVE` transaction. The
accepted implementation and its direct tests are:

- `python/src/graph_engineering/sqlite_operation_baseline_source.py`;
- `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py`;
- `python/src/graph_engineering/sqlite_cursor_publication_clock_authority.py`;
- `python/src/graph_engineering/sqlite_cursor_publication_target_catalog.py`;
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py`;
- `python/tests/test_sqlite_cursor_publication_migration_0002_execution.py`; and
- `python/tests/test_sqlite_cursor_publication_target_catalog.py`.

The clock and target-catalog changes close captured-owner seams used by the
writer. They do not add public API. Every new runtime name remains an underscore
intrinsic and is absent from the package root.

## Source-owned sequential execution session

The baseline connection owner now provides one opaque, exact-identity
migration session. A caller supplies the package-minted asset, never arbitrary
SQL. Session construction revalidates the installed asset identity and frozen
20-statement tuple, proves the live exclusive transaction generation, checks
all twelve reserved TEMP names in one fixed preflight query and captures the
initial epoch and `total_changes` watermark.

Only `execute-next` can advance the session. For statement ordinal `N` it:

1. verifies the exact connection, session, transaction generation, epoch and
   change-counter watermark;
2. opens one native cursor;
3. increments `prepared_statement_count`;
4. increments the transaction epoch immediately before native execute;
5. executes exactly frozen statement `N` with an empty parameter tuple;
6. records completion immediately after native execute returns;
7. reconciles native rowcount with the `total_changes` delta; and
8. closes the cursor exactly once while retaining the primary failure if close
   also fails.

The Python transaction epoch deliberately uses its unbounded built-in integer
domain. The affected-row and native `total_changes` ledgers remain bounded to
the portable safe-integer domain. Statement 4 must affect exactly one schema
row, statement 17 must affect exactly `L` legacy operation rows and every other
statement must contribute zero. An execute, rowcount, counter or cleanup fault
poisons the session while retaining every irreversible prepared/completed,
epoch, affected-row and native-counter observation available at the boundary.

The session registry uses integer identity keys plus exact weak referents.
Losing the caller's last execution handle removes the entry naturally; a
wrong connection, clone or later object reusing an integer id cannot obtain
authority.

## Outer writer and authenticated receipt

`_execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic` accepts only
the exact active outer authority. It loads the installed asset afresh, validates
its manifest, asset and schema hashes, opens the source-owned fixed-plan
session, records a fresh exact v1 physical catalog, executes all 20 statements
sequentially and records a fresh exact v2 target catalog.

The writer advances three independent ledger dimensions:

- affected rows: `1 + L`;
- fixed statements: `20`; and
- logical write sequence: `1`, only after the complete receipt is ready.

The receipt retains exact before/after epoch and `total_changes`, the full
20-element affected-row vector, source and target catalog hashes, application
and user versions, asset/manifest/schema identities, the three-dimensional
before/after/delta ledger, and canonical parameter/result digests. The canonical
empty migration parameter digest is
`8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a`.
The result digests proven by the real fixtures are:

- `L=0`: `2475973b53ba5659827cf78fca83b7a040172ae04e0c03d7de1cd7a297f1a96e`;
- `L=2`: `9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417`.

The receipt is opaque and registered by exact identity. Its record holds the
authority through a weak reference, avoiding the Python non-ephemeron cycle
`authority -> receipt -> receipt record -> authority`. Reading a receipt
revalidates the active authority, transaction generation, lower-bounded live
ledger, current asset identity and exact authority-owned receipt relation.

Replay is terminal and is rejected before any SQL. The outer write phase moves
through `ready-0002`, `executing-0002`, `0002-complete` or terminal poison/
retirement. On partial failure it copies the source session's irreversible
progress into the outer ledger before poisoning the complete stage graph.

## Catalog and dependency hardening

The target-catalog module now separates a generic physical observation from the
exact v2 validator. This permits the writer to prove the exact v1 source catalog
before DDL while preserving the strict validated-v2 API for downstream gates.
Both paths use the captured baseline owner execute descriptor; later class or
module replacement cannot redirect the native query lane.

The outer module captures the asset loader/reader, source session operations,
catalog observer and digest functions at import time. The clock authority also
uses its captured owner execute binding when checking the live lock. Hostile
post-import replacement therefore either has no effect or fails closed at an
authenticated boundary.

## Failure containment and adversarial coverage

The final writer suite contains 40 tests. It covers:

- exact real-SQLite success for `L=0` and `L=2`;
- exact 20-statement order, epoch delta, rowcount vector and three-ledger
  receipt values;
- replay with zero SQL and rollback/rebegin retirement;
- forged, cloned and cross-run receipt/session presentation;
- all twelve reserved TEMP shadow conflicts;
- source metadata, target catalog, asset, manifest, ledger and lineage drift;
- a real statement-12 collision preserving 11 completed statements and the
  attempted twelfth epoch;
- statement-4 rowcount and counter observation faults after the native write;
- hostile native counter shapes and native execute failure;
- preflight cursor-open failure with zero session, epoch and ledger movement;
- statement-5 cursor-open failure preserving exactly four completed statements
  without consuming a fifth attempt epoch;
- cleanup failure with exact-once close and primary-over-cleanup precedence;
- captured dependencies and package-root privacy; and
- natural collection of execution, receipt and authority graphs.

The two registry tests first force collection and then sample their weak-map
baseline. This prevents unrelated collectible objects abandoned by earlier
tests from producing an order-dependent false failure. They were additionally
run five consecutive rounds, and a no-cleanup probe proved all five related
authority/evidence/transfer/receipt/execution registries return naturally to
their exact baseline.

## Final verification on the accepted byte set

- migration-0002 writer suite: **40 passed**;
- integrated clock/target/asset/writer/outer/source/source-fence matrix:
  **175 passed in 244.68s**;
- TypeScript outer-authority oracle: **30 passed in 29.85s**;
- Ruff check: passed for all seven changed production/test files;
- Ruff format check: all seven files already formatted;
- authoritative `cd python && uv run mypy`: **101 source files**, no issues;
- `git diff --check`: passed; and
- two independent audit rounds ended at **HIGH 0 / MEDIUM 0 / LOW 0** after
  adding the missing cursor-prepare fault boundaries.

The first complete Python run was intentionally not accepted: it reported
**3507 passed, one failed and two subtests passed in 1737.10s**. The sole
failure exposed a regression already published in `2e9f7b2`: an ownership
lifecycle early-return rejected an exact second B2 campaign before the TEMP
stage's one-shot latch could poison itself. The minimal repair removes only
that redundant early-return. Exact presentation validation remains before the
stage mutation boundary; authentic replay again enters the stage-owned latch,
burns it and poisons transfer, campaign and stage together.

The failed node then passed **1/1**. Six adjacent exact/clone/tail/later-
lifecycle replay cases passed **6/6 in 17.94s**, and independent review found
no presentation-order regression. The final complete Python suite on the
repaired byte set passed **3508 tests plus 2 subtests in 1733.09s**, with zero
failures, zero skips and exit code zero.

## Explicit nonclaims and ordered continuation

This acceptance is the migration writer, not complete §31.37.38. It does not
mint the independent fresh post-DDL catalog fence, open or close the post-DDL
reader lease, write baseline entries/header/sequence, consume four typed
receipts, publish their tombstones, adopt the stage, rebind the cursor, prove
rules 11/12, retire TEMP state, commit, run the Python/Node 28-field native
parity campaign or activate the v2 manifest.

The next isolated leaf is the fresh post-DDL physical-catalog fence. It must
accept the exact authority and migration receipt, independently reread the
validated target catalog through a captured dependency, bind that observation
to the same transaction/epoch/change/ledger watermark and mint one opaque
weakly registered fence without consuming a write receipt. The reader lease
and terminal close proof remain the leaf after that fence.
