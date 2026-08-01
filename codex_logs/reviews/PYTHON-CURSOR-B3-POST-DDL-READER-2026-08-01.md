# Python SQLite cursor B3 post-DDL publication reader acceptance — 2026-08-01

## Outcome

This record accepts the package-private Python post-DDL publication reader
leaf authorized by master-plan sections 31.37.30 and 31.37.46.5. The leaf
starts only after migration `0002` and its fresh physical-catalog fence have
completed. It accepts the exact live outer authority, authentic migration
receipt and authentic post-DDL catalog fence, reads the retained B2 TEMP
projection once, closes its package-owned cursor exactly once and retains an
immutable, rederived projection for the next permanent baseline-entry writer.

The accepted boundary deliberately stops before any permanent baseline entry,
header or operation-sequence write. It consumes no initial-write receipt,
mints no stage-adoption authority, performs no cursor rebind, owns no
transaction-control primitive and advances no permanent-write ledger.

## Files in the accepted leaf

- `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py`
  owns the opaque one-shot lease, exact graph registry, execution state
  machine, 31-field snapshot, terminal proof and private retained-entry
  successor accessor.
- `python/src/graph_engineering/sqlite_operation_baseline_source.py` owns the
  closed-set source reader primitive and captured native cursor descriptors.
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py`
  registers, completes and replays the shared cleanup continuation.
- `python/src/graph_engineering/sqlite_operation_baseline_stage.py` preserves a
  failed reader cleanup continuation across poison/dispose and clears it only
  after a successful close.
- `python/src/graph_engineering/sqlite_cursor_publication_clock_authority.py`
  and `python/src/graph_engineering/sqlite_cursor_publication_target_catalog.py`
  capture cursor methods exposed by hostile late-replacement coverage.
- `python/src/graph_engineering/sqlite_operation_baseline.py` closes the
  accumulator's late-bound canonical-entry capture seam.
- `python/tests/test_sqlite_cursor_publication_post_ddl_reader.py` is the
  focused 65-case hostile acceptance suite.

## Fixed source statement and closed-set ownership

The only permitted source statement is:

```sql
SELECT kind_rank, entry_kind, key_blob, state_blob FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC
```

Its exact UTF-8 SHA-256 is
`adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f`.
The caller cannot supply SQL, parameters, a cursor, rows, a count, a projection
or a cleanup callback.

The source owner exposes only package-private prepare, fixed execute, fetch-one,
close and snapshot intrinsics. Prepare allocates a cursor without executing.
Execute uses the fixed zero-parameter statement. Native connection and cursor
descriptors are captured at module initialization, so replacing class or
module methods after graph creation cannot redirect this lane.

The outer lease records prepare and ownership separately. A prepare failure
leaves every outer reader counter at zero. A source execute/acquisition failure
records outer prepare once but no execute, ownership, fetch or close; its
prepared source cursor is still aborted once through the private source lane.
After ownership, every terminal or failing path must close exactly once.

## Exact lease graph and weak registry

The lease is exact-type, opaque, weak-referenceable and constructible only with
the module construction token. One authority can mint it once. The registry
record stores upstream identities as integer ids plus weak references:

- outer authority;
- migration-0002 receipt;
- post-DDL catalog fence;
- TEMP stage;
- stage-ownership transfer; and
- exact projection reference.

The record stores only scalar projection commitments, scalar counters,
watermarks, transaction identity, an immutable rederived projection and the
terminal immutable entry tuple. It does not store a connection, native cursor,
cleanup closure, cached graph snapshot or exception/traceback graph.

Snapshots reconstruct connection and graph-bearing fields from live weak
referents. A live orphan lease cannot keep the authority, receipt, fence or
stage alive. A close-failure orphan likewise cannot keep them alive: retained
close state is a scalar error code, and the source reader registry returns to
its baseline when the package-owned source handle dies.

## Exact 31-field snapshot

The observable `NamedTuple._fields` order is frozen as:

1. `authority`;
2. `close_attempt_count`;
3. `close_succeeded`;
4. `connection`;
5. `consumes_any_write_receipt` (`False`);
6. `read_proof_epoch`;
7. `execute_count`;
8. `fetch_count`;
9. `lifecycle`;
10. `may_mint_stage_adoption_receipt` (`False`);
11. `migration_0002_receipt`;
12. `mint_count` (`1`);
13. `outer_ledger_read_watermark`;
14. `ownership_acquisition_count`;
15. `permanent_write_authority` (`False`);
16. `post_ddl_catalog_fence`;
17. `prepare_count`;
18. `projection_identity`;
19. `projection_reference`;
20. `rederived_entry_count`;
21. `rederived_final_entry_hash`;
22. `rederived_first_entry_hash`;
23. `rederived_legacy_operation_count`;
24. `rederived_projection_sha256`;
25. `source_read_sql`;
26. `source_read_sql_sha256`;
27. `stage`;
28. `total_changes_read_watermark`;
29. `transaction_generation`;
30. `transaction_epoch`; and
31. `transfer`.

The five rederived fields are `None` before a complete projection exists.
After retirement, snapshot read is itself a live proof operation: it reruns the
complete terminal assertion, physical catalog fence, authority lineage and
read watermarks. Rollback/rebegin, catalog mutation, connection closure or
authority poison therefore rejects a stale retired snapshot rather than
returning cached success diagnostics.

## Row and projection proof

The reader fetches at most `expected_entry_count + 1` rows. Each nonterminal
row must be an exact four-item tuple containing:

- an integer rank in the closed entry-kind range;
- the exact entry kind corresponding to that rank;
- a bytes key blob; and
- a bytes state blob.

Key and state blobs are independently size bounded, strict UTF-8/JSON decoded,
recaptured through the canonical baseline-entry constructor and required to
round-trip to their exact original bytes. Rows must be strictly ascending by
rank then key bytes; reverse order, duplicates, unexpected extras and
truncation fail.

A fresh `BaselineAccumulator` rederives baseline id, entry count, legacy
operation count, first entry hash, final entry hash and projection SHA-256.
Every value must exactly match the authentic projection and projection
reference graph. Only a terminal retired lease exposes the immutable retained
entry tuple to the future private baseline-entry writer; the successor cannot
issue a second TEMP projection SELECT.

## Lifecycle and cancellation

The successful lifecycle is:

`minted-unused -> reader-active -> reader-closed -> retired`.

`reader-closed` is an internal synchronization state. Only `retired` is a
terminal proof. Every invariant failure after ownership produces `poisoned`.

A valid already-cancelled signal is observed before prepare. The lease remains
`minted-unused`, all counters remain zero and the same lease is retryable. An
invalid cancellation object is a non-poisoning presentation error.
Cancellation after ownership always requires the one close attempt, never
produces terminal proof and poisons the graph.

## Exact failure and cleanup precedence

The accepted order is:

1. presentation and graph provenance before SQL;
2. fixed SQL/hash, live fence, lineage and watermarks before prepare;
3. row/fetch/decode/order/hash/projection primary failure before cleanup;
4. native close failure before cancellation when no row primary exists;
5. cancellation after ownership before any later TEMP/outer cleanup failure;
6. cleanup completion or graph-cleanup failure only when no earlier primary
   exists.

Thus row plus close plus cancellation reports the row primary; close plus
cancellation reports close; and cancellation observed before a later stage
dispose or outer poison reports cancellation.

The stage and ownership bridge share one exact-once continuation. The native
close attempt is recorded before invoking the close primitive. On success the
continuation is cleared from both owners. On failure it remains installed and
replays the retained scalar close code through later stage dispose/poison and
ownership/outer retire/poison paths without another native close.

The first outward close error preserves the exact native cause in an
execution-local value. That value is removed from the installed closure before
control escapes. Registry state retains only the stable error code, preventing
exception traceback frames from creating a non-ephemeron path back to the
reader, authority or connection graph.

## Hostile acceptance matrix

The focused suite covers:

- real legacy-count zero and two projections;
- exact 31-field order and all non-authority claims;
- exact SQL text/hash, zero parameters and one prepare/execute;
- fresh fence calls at mint, execute, terminal assert and retired snapshot;
- wrong graph, substituted receipt/fence, forged object, clone, cross-run and
  replay rejection;
- preownership cancellation and same-lease retry;
- prepare and source execute/acquisition failure counters;
- truncation, malformed row tuple/rank/kind/blob, invalid UTF-8, noncanonical
  JSON, oversized key/state blobs, reverse order, duplicate/extra row and
  projection mismatch;
- row plus close, row plus close plus cancellation, close-only, close plus
  cancellation and postownership cancellation precedence;
- terminal-fetch cancellation and cancellation before later stage/outer
  cleanup;
- rollback, catalog drift, watermark drift and connection-close behavior;
- stage dispose/poison, ownership retire and outer poison/retire cleanup;
- close-failure continuation replay with one native close;
- reentrant execution, active terminal proof and stale retired proof;
- hostile cursor, accumulator, canonical/JSON and SHA dependency replacement;
- package-root privacy and absence of transaction/permanent-write authority;
  and
- live-orphan, failed-close-orphan and joint graph collection with registry
  cardinalities returning to their baselines.

## Verification on the frozen production/test byte set

- focused Python reader suite: **65 passed in 280.66 seconds**;
- adjacent Python clock/target/migration/fence/outer/reader integration:
  **181 passed in 605.32 seconds**;
- TypeScript outer-authority plus post-DDL-reader behavior oracle:
  **65 passed in 31.54 seconds**;
- Ruff check: all eight changed Python production/test files passed;
- Ruff format check: all eight files already formatted;
- mypy: **101 source files**, no issues;
- `git diff --check`: passed;
- independent contract audit after remediation: **HIGH 0 / MEDIUM 0 / LOW 0**;
- independent security audit after remediation: **HIGH 0 / MEDIUM 0 / LOW 0**;
- complete Python suite: **3,577 passed in 2,120.22 seconds (35:20)**, with
  zero failures, zero skips and exit code zero.

## Audit-discovered defects closed in this leaf

The parallel hostile implementation and two independent audits changed the
implementation materially. They found and closed:

1. stage/ownership cleanup continuations that were cleared after close
   failure instead of retained;
2. a wrapper that silently returned on replay instead of replaying retained
   close failure;
3. retained exception objects whose traceback frames kept a reader graph
   alive;
4. stage-dispose residue errors that could replace an earlier close primary;
5. cancellation followed by stage/outer cleanup selecting cleanup instead of
   cancellation;
6. retired snapshot reads that exposed cached terminal diagnostics without a
   fresh proof;
7. 31-field snapshot ordering drift;
8. cursor methods dynamically resolved after module initialization; and
9. an accumulator canonical-entry helper dynamically resolved after graph
   construction.

Every item has a permanent regression test. None is merely recorded as future
test debt.

## Explicit nonclaims and next leaf

This acceptance does not write baseline entries, the baseline header or
operation sequence zero. It does not mint or consume their receipts, perform
four-receipt atomic stage adoption, create a publication session, rebind the
cursor, prove rules 11/12, retire TEMP state, commit the transaction, activate
the v2 manifest, publish a release or guarantee external GitHub adoption.

The next isolated leaf is the baseline-entry permanent publication receipt.
It may consume only the exact terminal reader proof and its private immutable
entry tuple, must not issue a second TEMP read, and must stop before the header
writer or any later adoption/session/rebind/commit authority.
