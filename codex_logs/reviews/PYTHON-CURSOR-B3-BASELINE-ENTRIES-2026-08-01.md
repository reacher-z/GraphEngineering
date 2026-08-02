# Python cursor B3 baseline-entry publication review — 2026-08-01

## Outcome

This review records the Python implementation of the second ordered B3
initial-write receipt: permanent publication of the exact retained baseline
entries. The implementation and final regression are complete at this bounded
leaf. The complete Python suite passed on the same frozen production and test
bytes used by the focused, integrated and audit gates.

The leaf does not publish the baseline header or operation-sequence zero, does
not consume the receipt, does not adopt the TEMP stage, does not rebind cursors
and does not commit the caller-owned transaction.

## Frozen implementation inputs

The final audited file identities are:

- `sqlite_operation_baseline_source.py`:
  `35edfe07066f806b20f658210c398f507d36058002e34292692db4720175c1a3`;
- `sqlite_cursor_publication_outer_authority.py`:
  `306eab0fd6a6b0f6c4010d5d6cfb9690e06113663393f5137b6038942fc3b480`;
- `test_sqlite_cursor_publication_baseline_entries.py`:
  `c577bd90b06d687b36953cb1b8053fe956b1e5699f9564f5f49095e26198f519`.

The hostile test file contains 1,840 lines. Production and test bytes were
frozen before the authoritative 64-case focused run, serial integration run,
static gates and final contract audit.

## Exact statement boundary

The only new permanent SQL is:

```sql
INSERT INTO main.ge_cycle_operation_baseline_entries (baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
```

It is exactly 183 UTF-8 bytes and hashes to
`b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b`.
The source owns the literal. The outer authority supplies exactly seven
internally rebuilt values for each retained entry. No caller SQL, second TEMP
read, transaction control, savepoint or implicit transaction replacement is
part of the leaf.

CPython's standard `sqlite3` binding has no prepare-only API. The new Python
`prepare_count` records exactly one captured cursor/session allocation. It
does not assert native SQLite compilation before the first execute. For an
empty projection, the session is allocated and closed exactly once with zero
SQL, zero epoch advance and zero `total_changes` delta. The implementation
does not simulate prepare with `EXPLAIN`, rollback DML or native-handle access.

## Source-owner execution

The source adds an opaque, registry-authenticated, one-shot baseline-entry
execution. The record binds the exact connection and exclusive transaction
generation, expected entry count, initial/current epoch, initial/current
`total_changes`, attempt count, completed-native-return count, next ordinal,
actual affected rows, lifecycle and cleanup evidence.

Nonempty execution accepts exactly `E` calls in zero-based ordinal order. Each
call binds baseline ID, ordinal, kind, key BLOB, state BLOB, previous hash and
entry hash. Values are copied into a package-owned tuple before the captured
cursor method is invoked.

The native return is irreversible. Completed count and epoch are advanced
before result and later counter validation. A wrong row count or counter drift
therefore leaves the true physical progress visible. An already terminal or
replayed session is rejected without another run or close and retains its
terminal lifecycle. Foreign-connection presentation is likewise rejected
without mutating a valid execution. Validation, owner/lineage/ordinal, native,
result or counter failures on an allocated active session poison it.

The 14-field source snapshot reports affected/completed/attempted/expected
counts, lifecycle, next ordinal, prepare count, before/current/delta
`total_changes`, transaction epoch and generation, close attempts and close
success.

## Cleanup and failure precedence

The cursor is closed exactly once on empty success, nonempty success, parameter
or owner validation failure, native throw, result failure and counter failure.
Private state immediately drops the cursor after the attempt. Re-reading or
replaying the session never closes again.

Primary semantic/native failures outrank close failures. Only a scalar cleanup
code is retained; no exception or traceback is retained. If the rows succeed
and final cleanup alone fails, the source reports
`GE_CURSOR_B3_BASELINE_ENTRY_CLEANUP`, preserves full physical progress and
poisons. The outer authority mints no receipt.

## Outer-authority proof

The outer writer accepts only the exact active authority, authentic
migration-0002 receipt, authentic catalog fence and exact retired reader lease.
It freshly verifies exclusive lineage, epochs, counters, phase, reader close
success, projection identity/reference and the retained-entry rederivation.
Clone, structural-copy, wrong-run, stale or replayed predecessors cannot reach
cursor allocation.

Rows come only from the private terminal reader accessor. The writer reproves
vector length, baseline ID, ordinal continuity, genesis predecessor, complete
hash-chain continuity, first/final hashes and projection terminus. It issues no
second query against `temp.ge_blr_stage`.

The builder and verifier are different implementations. Both reconstruct the
complete dense `E x 7` tagged frame and independently compute parameter and
aggregate result digests. The aggregate result is exactly
`{"affectedRows":"E"}`. Complete DML without agreement between the two passes
does not mint a receipt.

After each row, the outer writer verifies ordinal, prepare count, execute
attempt, completed count, affected rows, epoch, `total_changes` and transaction
generation. A source error triggers a best-effort terminal snapshot read so
real physical progress remains represented without replacing the primary
failure.

## Receipt and ledger

The receipt is opaque and registry-authenticated. Its 34-field snapshot binds:

- graph identities: authority, connection, migration receipt, catalog fence,
  reader lease, projection identity and projection reference;
- baseline commitments: ID, count, first/final hashes and reader rederived
  projection digest;
- SQL commitments: source SELECT and permanent INSERT text plus SHA-256;
- execution commitments: prepare/execute/affected counts, before/after epochs,
  generation and before/after/delta `total_changes`;
- canonical parameter and result digests;
- before/after/delta outer ledgers, mint count and write kind; and
- reader lifecycle and close count.

The weak receipt record stores scalar commitments, the transaction-generation
identity, exact object identity values and weak references. It retains no
connection, projection, entry vector, snapshot, cursor, exception or traceback
strongly. Assertion is reusable and non-consuming. It accepts later authorized
ledger advancement and rejects regression.

Source and INSERT SQL/SHA pairs are captured at module load and copied into the
receipt record. Assertion compares the record to the captured pair and freshly
hashes record SQL. Paired mutation of public SQL and SHA globals cannot alter a
historical receipt; direct record mutation is rejected and poisons.

The successful phase is
`post-ddl-reader-closed -> executing-baseline-entries -> baseline-entries-complete`.
For the 12-entry, one-legacy-row fixture the ledger moves from `1/20/2` to
`2/32/14`: logical `+1`, fixed statements `+12`, affected rows `+12`.
Prepare failure preserves `1/20/2`. A six-return failure preserves `1/26/8`,
logical one and mint zero. Full DML followed by digest or cleanup failure keeps
all physical counts but never reaches logical sequence two.

## Hostile defects closed during implementation

1. Per-step validation originally omitted exact `total_changes` comparison.
   The outer writer now checks every source observation.
2. The first verifier shared implementation with the frame builder. It was
   replaced by an independently coded second pass and separate seam tests.
3. Receipt snapshot SQL could follow later module-global mutation. Historical
   receipts now carry captured canonical SQL/SHA commitments and fresh hashes.
4. Nonempty cursor cleanup was not universal. All success/failure/close-fault
   paths now expose exact-once cleanup evidence and release the cursor.

## Executed validation

- focused Python hostile suite: 64 passed in 276.44 seconds;
- serial nine-file source/clock/target/migration/authority/fence/reader/entries
  integration: 312 passed in 875.51 seconds;
- TypeScript baseline-entry oracle: 20 passed in 19.46 seconds;
- Ruff check: passed;
- Ruff format check: three files already formatted;
- mypy: success across 99 source files;
- `py_compile`: passed;
- `git diff --check`: passed;
- implementation security/failure audit: HIGH 0 / MEDIUM 0 / LOW 0;
- independent plan-to-code final audit: HIGH 0 / MEDIUM 0 / LOW 0.

The complete `python` pytest regression passed 3,641/3,641 in 2,387.80 seconds
(39 minutes 47 seconds), with zero failures and zero skips, on the same
production and test bytes.

## Final gate

All mandatory bounded-leaf gates are green. The focused, serial integration,
TypeScript oracle, static/type/compile/whitespace, complete Python regression,
two implementation audits and append-only documentation re-audit agree on the
same capability boundary. This record authorizes one scoped baseline-entry
commit and push; it authorizes only the baseline-header successor described in
the plan.

## Append-only plan proof

Before section 31.37.48 was appended, the master plan had 16,768 lines and
SHA-256
`a9a267c1ecb9e9617c48b02735bb5d912ed31efdb0d7214cb986ca3c67b2460c`.
After the first acceptance append it has 17,063 lines and SHA-256
`960aeaf7604567389a8ff7b8d6489e50cb8d0dd95472d9fd29ae138af7c0378f`.
Rehashing the first 16,768 lines reproduces the original digest exactly.

## Nonclaims and successor

This work does not claim native prepare-before-execute, header publication,
sequence-zero, receipt consumption, adoption, rebind, TEMP retirement,
transaction commit, manifest activation, release readiness or a guaranteed
external star count.

After the complete regression and scoped commit, it authorizes only the Python
baseline-header leaf. The successor uses the frozen 488-byte header SQL and
SHA `b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a`,
fourteen parameters, Python runtime identity `graph-engineering-python@0.1.0a1`,
the 946-byte canonical policy and an independent `1 x 14` verification pass.
