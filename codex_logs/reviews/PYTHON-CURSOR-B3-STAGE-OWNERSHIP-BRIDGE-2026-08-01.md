# Python cursor B3 stage/ownership bridge acceptance — 2026-08-01

## Accepted boundary

This record accepts the package-private Python bridge from one exact completed
B2 pre-rebind campaign into outer-publication ownership and, after a future
publication writer supplies its authenticated watermark, into atomic initial
stage adoption. The accepted files are:

- `python/src/graph_engineering/sqlite_operation_baseline_stage.py`;
- `python/tests/test_sqlite_operation_baseline_stage.py`;
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py`;
- `python/tests/test_sqlite_operation_baseline_cursor_stage_ownership.py`.

The bridge is not the permanent publication writer. It executes no migration
0002 statement, mints none of the four permanent-write receipts, performs no
cursor rebind, applies neither rule 11 nor rule 12, and owns no commit or
rollback boundary.

## Implemented state machines

The TEMP stage now retains exact, bounded states for outer publication,
post-DDL reader cleanup, B2-fence retirement and initial-publication adoption.
The ownership bridge advances the corresponding transfer lifecycle through:

1. `b2-active`;
2. `pre-rebind-complete`;
3. `outer-publication-prepared`;
4. `outer-publication-owned`;
5. `initial-publication-adoption-prepared`;
6. `initial-publication-adopted`;
7. terminal `retired` or `poisoned`.

Every publication tail is an exact module-minted identity. Validation happens
before the tail is armed. A publish consumes the registry entry before it
enters the lower assignment tail. Replay, substitution, dead referents and a
tail retained across retirement or poisoning are rejected without revival.

## Cached B2 completion gate

The outer preparation path no longer reruns the SQL-heavy B1 transfer proof.
It checks the exact registered stage, connection, receipt, projection,
transfer session, campaign completion, transaction lineage, epoch and
`total_changes`, together with the cached cursor-seal created/rootpage/catalog
snapshot proof. The proof calculation is deterministic and SQL-free. Raw
SQLite tracing stays empty for the valid path and for all five tampering
vectors.

## Reader ownership and exact-once cleanup

The bridge registers one post-DDL reader lease and one cleanup continuation.
The continuation marks itself attempted before invoking caller cleanup. Stage
disposal followed by ownership retirement therefore attempts cleanup exactly
once even if the cleanup itself raises. A successful reader close clears the
stage continuation before adoption; a failed or abandoned close is terminal.

## Atomic adoption boundary

Preparation validates and copies the outer ledger and stage watermark, reads
the post-DDL catalog fence, mints one retired-B2-fence identity and arms one
lower adoption tail. It does not mutate the permanent database. Publication
burns the outer wrapper tail and marks its transfer poisoned before calling the
lower stage tail; only a successful lower call advances to adopted. A real
prepare-to-publish DDL drift proves that the lower exception is preserved,
both tails remain burned, and repeated publish, repeated prepare and transfer
assertion cannot revive the graph.

Successful adoption preserves the exact post-DDL catalog, ledger watermark,
transaction lineage, epoch and `total_changes`; retires the old B2 fence;
keeps the TEMP stage alive for the later rebind/rule proofs; and exposes only
tuple-backed immutable watermark values.

## Weak-registry and abandonment proof

Python `WeakKeyDictionary` is not an ephemeron. The first draft therefore
formed a real cross-registry strong cycle: outer state retained transfer,
transfer metadata retained stage, and stage/metadata retained outer authority.
The cycle was reproduced before repair.

The accepted implementation stores the outer authority through exact weak
references in the stage, ownership metadata, tail continuations and adoption
records. It does not retain an authority-bearing mint as canonical metadata.
Live repeated minting reconstructs a tuple with the same authority and tail
identities. Loss of the authority referent makes every surviving tail
terminally invalid.

Prepare abandonment, published disposal and full outer-graph natural
abandonment were each exercised with double garbage collection. Authority,
transfer and stage weak references clear, while stage tail registries,
ownership transfer registries and outer link registries return to their exact
pre-test sizes.

## Failure and drift coverage

The focused suite covers, among other cases:

- exact preparation, publication and replay;
- clone, wrong-run and wrong-identity substitution;
- dead authority referents and non-revivable live tails;
- retirement and poisoning before either publication tail;
- stage disposal plus ownership cleanup;
- reader close success, failure and exact-once cleanup;
- DML drift and rollback/rebegin transaction replacement;
- prepared adoption drift at the real lower stage;
- adopted catalog, epoch, lineage and change-counter drift;
- prepare abandonment and published-stage garbage collection; and
- package-private root isolation.

## Final verification on the accepted byte set

- stage focused suite: **64 passed**;
- ownership focused suite: **54 passed**;
- combined stage/ownership suite: **118 passed**;
- integrated stage/ownership/outer suite: **133 passed in 117.11s**;
- Ruff check: passed for all six integrated source/test files;
- Ruff format check: six files already formatted;
- authoritative `cd python && uv run mypy`: **101 source files**, no issues;
- `git diff --check`: passed; and
- final adversarial audit: **HIGH 0 / MEDIUM 0 / LOW 0**.

## Remaining ordered work

This acceptance supplies the bridge needed by the Python outer authority. It
does not complete section 31.37.38. Remaining work still includes the exact
migration-0002 execution owner, physical-catalog reader lease, four permanent
write receipts and tombstones, atomic receipt-bundle adoption, rebind/rules
11/12, native parity report and full Python-suite acceptance.
