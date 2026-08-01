# Python cursor B3 outer-authority activation acceptance — 2026-08-01

## Accepted boundary

This record accepts the first package-private Python outer-publication authority
leaf in:

- `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py`;
- `python/tests/test_sqlite_cursor_publication_outer_authority.py`.

The leaf binds one exact completed B2 stage/ownership graph to one migration
lock, provider-clock capability and first permanent-mutation boundary evidence.
It prepares an inactive authority, supports cancellation before the one-way
tail, consumes the exact clock evidence during activation, retains the exact
tombstone and publishes the already-prepared stage owner.

This is deliberately an activation foundation. It contains no SQL text,
executes no migration, mints no permanent-write receipt, changes no database
counter, performs no cursor rebind and owns no transaction completion.

## Identity and registry design

Authority, cancellation, evidence-link and transfer-link registries are
id-keyed and carry exact weak referents. Lookup first requires exact built-in
type and then `referent is object`; caller equality and hash hooks are never
authority. Every replaceable production dependency used at the tail is
captured at import time.

Repeated preparation with the same inactive graph returns the same authority.
An evidence/transfer mismatch, clone, cross-run object or already active,
retired or poisoned graph is rejected. Authority state retains the immutable
source hashes, projection reference, transaction generation, preparation
epoch/change counters, first provider timestamp and zeroed outer ledger.

## Cancellation and activation

A valid cancelled signal is the sole retryable inactive exit. It is checked
before revalidation, evidence consumption or tail arming. The same authority
can later be activated without the cancelled signal.

Activation performs all fallible graph validation first. It then consumes the
exact first clock evidence, retains its exact consumed tombstone, publishes the
single-use ownership tail and advances activation count from zero to one. A
fault after evidence consumption retains the tombstone, poisons outer,
ownership and stage state, and prevents every retry.

## Active clock graph

The active assertion retains the historical first-evidence/tombstone proof but
does not incorrectly freeze the provider clock head or the preparation epoch.
Later valid boundaries may advance the clock chain. Future authenticated write
owners may advance the authority's mutable current epoch and `total_changes`
watermark. The assertion compares that current watermark with the live owner,
while the first evidence remains historical provenance only.

A later provider boundary failure poisons the provider-clock capability and is
therefore rejected by the active outer authority. A valid later boundary does
not poison or stale the authority. Loss of the transaction generation retires
the graph; ledger drift or a non-stale invariant failure poisons it.

## SQL and transaction boundary

Raw SQLite tracing around both preparation and activation records no SQL. The
transaction epoch, `total_changes`, TEMP catalog and EXCLUSIVE ownership remain
unchanged. Static source assertions reject embedded SQL, commit, rollback,
rebind or public-root exposure. The authority is package-private and absent
from the friendly package namespace.

## Garbage-collection proof

The first implementation exposed a real Python cross-registry retention cycle.
That defect was fixed jointly with the stage/ownership bridge. The durable
outer test now covers both inactive and active natural abandonment without an
explicit cleanup call. After all caller references are dropped and garbage
collection runs twice:

- authority, transfer and stage weak references are dead;
- the authority registry returns to its exact baseline;
- evidence and transfer link registries return to their exact baselines; and
- the ownership transfer registry returns to its exact baseline.

This test guards the Python-specific difference between ordinary weak maps and
JavaScript ephemeron-aware `WeakMap` semantics.

## Adversarial coverage

The focused oracle covers:

- exact inactive preparation and idempotency;
- cancellation followed by corrected activation;
- post-import replacement of captured dependencies;
- preconsumed and obsolete first evidence;
- clone and cross-run substitution;
- inactive and active rollback/rebegin retirement;
- legal later clock advancement;
- provider failure and clock-poison propagation;
- current watermark advancement independent of first-evidence epoch;
- injected ownership-publish failure after clock consumption;
- retained tombstone and three-layer poison after tail failure;
- inactive and active natural-abandonment collection;
- transitive zero-SQL/zero-transaction ownership; and
- runtime and source-level package privacy.

## Final verification on the accepted byte set

- outer-authority focused suite: **15 passed**;
- integrated stage/ownership/outer suite: **133 passed in 117.11s**;
- Ruff check: passed for all six integrated files;
- Ruff format check: six files already formatted;
- authoritative `cd python && uv run mypy`: **101 source files**, no issues;
- `git diff --check`: passed; and
- final independent audit: **HIGH 0 / MEDIUM 0 / LOW 0**.

## Remaining ordered work

The active authority's `write_phase` is ready for migration 0002, but this leaf
does not execute it. The next leaf must load the installed migration asset
afresh, validate its frozen identity, execute exactly 20 owned statements and
advance the authenticated write ledger without commit, rollback, rebind or
ambient `executescript`. Post-DDL reader/catalog proof, four receipt owners,
atomic adoption, rebind/rules, parity and full-suite closure remain subsequent
gates.
