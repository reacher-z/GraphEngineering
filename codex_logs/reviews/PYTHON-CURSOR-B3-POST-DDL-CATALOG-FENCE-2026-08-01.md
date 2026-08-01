# Python cursor B3 post-DDL physical-catalog fence acceptance — 2026-08-01

## Accepted boundary

This record accepts the package-private Python physical-catalog fence between
the completed migration-0002 writer and the future post-DDL TEMP projection
reader. The implementation and direct tests are:

- `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py`;
- `python/src/graph_engineering/sqlite_cursor_publication_target_catalog.py`;
- `python/tests/test_sqlite_cursor_publication_post_ddl_catalog_fence.py`; and
- `python/tests/test_sqlite_cursor_publication_target_catalog.py`.

The leaf consumes no receipt and owns no permanent write. It performs one fresh
physical-catalog read at mint and another at every assert/read. It stops before
the reader lease, baseline entries/header/sequence, adoption, rebind, rules,
TEMP retirement and transaction completion.

## Exact fence graph

The outer authority now carries one optional fence pointer, mint count zero or
one and the additional write phase `post-ddl-catalog-fence`. The token is an
opaque exact-type weak-referenceable object constructible only with the module
token. Its private registry uses integer identity plus the exact fence weak
referent.

The registry record deliberately does not retain the connection, authority,
migration receipt or a snapshot containing them. It stores:

- authority id and weak reference;
- migration-receipt id and weak reference;
- mint-time transaction generation, epoch and `total_changes`;
- mint-time three-dimensional ledger; and
- frozen catalog application/version/count/bytes/hash/inventory scalars.

Read resolves the weak graph, reasserts it and reconstructs the 20-field
snapshot only after a fresh physical read succeeds. This avoids the Python
non-ephemeron cycle that would otherwise keep `authority -> fence -> registry
record -> authority` alive forever.

## Mint precedence

Mint accepts only the exact active authority and exact authentic migration-0002
receipt. Its order is fixed:

1. exact authority lookup;
2. replay detection before SQL, followed by terminal poison;
3. premature/incomplete 0002 detection before receipt validation and SQL,
   followed by terminal poison;
4. exact receipt registry, weak authority, connection relation and authority
   back-pointer validation as a non-poison caller presentation boundary;
5. active authority and live `BEGIN EXCLUSIVE` generation assertion;
6. authentic receipt reread plus exact equality of current epoch,
   `total_changes` and all three ledger dimensions with receipt after-values;
7. a new captured strict target-catalog read;
8. a second active-authority assertion after that read;
9. complete fresh/retained/frozen catalog comparison; and
10. one assignment-only token/registry/back-pointer/count/phase tail.

The fresh target proof uses the canonical `lower(name) GLOB 'ge_cycle_*'`
query and binds its exact SHA-256
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`,
the catalog digest domain, 34-row inventory, 5,785 canonical UTF-8 bytes,
application ID 1,195,724,359, user version 2 and target digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
It also compares canonical JSON, canonical row records, query identity and the
tuple-backed target descriptor identity against the migration receipt's
retained observation.

Mint changes no SQLite row, epoch, `total_changes` value or ledger dimension.
It does not consume the migration receipt and mints no tombstone.

## Reusable assertion and snapshot

Assert first resolves exact fence identity and verifies weak authority/receipt
ids, referents and authority back-pointers. A clone, forged token, wrong pair or
cross-run pair fails without SQL and without poisoning either healthy graph.
It then reasserts the live authority and receipt, requires the same transaction
generation and non-regressing epoch/change/three-ledger watermarks, performs a
new captured validated catalog read, reasserts the authority after the read and
compares the full target observation with the mint proof.

Read cannot expose a cached stale snapshot. It resolves the weak graph, invokes
the complete assert path, derives the connection from the live authority and
then reconstructs exactly these 20 fields:

1. `application_id`;
2. `authority`;
3. `catalog_canonical_utf8_bytes`;
4. `catalog_digest_domain_utf8`;
5. `catalog_inventory`;
6. `catalog_query`;
7. `catalog_query_sha256`;
8. `catalog_row_count`;
9. `catalog_sha256`;
10. `connection`;
11. `consumes_any_write_receipt=False`;
12. `is_final_v2_semantic_proof=False`;
13. `migration_0002_receipt`;
14. `mint_count=1`;
15. `outer_ledger_watermark`;
16. `proof_scope`;
17. `total_changes_watermark`;
18. `transaction_epoch`;
19. `transaction_generation`; and
20. `user_version=2`.

## Terminal lifecycle and unavailable classification

Rollback/rebegin retires the graph. Later calls cannot turn retired into
poisoned. Real catalog, epoch, counter or ledger corruption poisons the graph,
and later calls cannot turn poisoned into retired.

The fence path probes the captured native owner-open state before entering the
ordinary authority accessors. It repeats that probe when a target reader has
translated a native error, covering a connection closed between the first
authority assertion and physical read. Every such path produces the stable
`GE_CURSOR_B3_POST_DDL_CATALOG_UNAVAILABLE` without leaking a raw
`sqlite3.ProgrammingError`, and terminally poisons the live graph.

## Deferred catalog cleanup precedence

The target reader now records both catalog and metadata cursor close failures
instead of throwing them immediately after a successful fetch. It continues
through metadata shape checking, canonical row/JSON construction and full v2
validation. The exact precedence is therefore:

`fetch/read primary > metadata/row/catalog mismatch > deferred cleanup`.

Only a fully valid target may surface
`GE_CURSOR_B3_TARGET_CATALOG_CLEANUP`. Both cursors are closed exactly once.
The four-quadrant regression covers valid/invalid metadata crossed with catalog
or metadata close failure.

## Adversarial coverage

The 20-case fence suite covers:

- real `L=0` and `L=2` mint with exact 20-field snapshots;
- zero mint-side SQL mutation, epoch, counter and ledger change;
- one fresh reader call at mint and every assert/read;
- substituted receipt rejection followed by corrected success;
- premature and second-mint precedence with zero SQL;
- forged, cloned and cross-run fence presentation without graph damage;
- rollback/rebegin retirement and terminal replay;
- closed-connection stable unavailable classification;
- same-count SQL replacement before and after mint;
- unauthorized epoch and native-counter drift;
- catalog and metadata deferred cleanup precedence;
- post-import target/owner dependency replacement;
- package-root privacy and reader/write nonclaims; and
- natural authority/receipt/fence/stage collection with exact registry
  baselines.

## Final verification on the accepted byte set

- fence hostile suite: **20 passed**;
- target catalog suite: **29 passed**;
- target + fence final boundary: **49 passed in 80.01s**;
- final target/migration/fence/outer integration:
  **104 passed in 317.70s**;
- TypeScript outer-authority oracle: **30 passed in 29.20s**;
- Ruff check and format check: all four files passed;
- authoritative Python mypy: **101 source files**, no issues;
- `git diff --check`: passed; and
- independent contract and security audits: **HIGH 0 / MEDIUM 0 / LOW 0**
  after closing metadata-cleanup precedence and its documentation residue.

- complete Python suite: **3,529 passed plus 2 subtests in 1,817.32s**,
  with zero failures, zero skips and exit code zero.

## Explicit nonclaims and continuation

This fence is not the final v2 semantic proof. It does not open or close the
post-DDL publication reader, read TEMP baseline entries, mint a projection
reference, write baseline entries/header/sequence zero, consume receipts,
publish tombstones, adopt the stage, rebind the cursor, prove rules 11/12,
retire TEMP state, commit, rollback, activate the v2 manifest or claim release
or external adoption.

The next isolated leaf is the one-shot post-DDL publication reader lease and
terminal close proof. It must consume the exact authority, migration receipt
and fence; read only the fixed ordered B2 TEMP projection; bind the authentic
projection/projection-reference identities; close exactly once; retain the
rows privately for the future baseline-entry writer; and become terminally
retired before stage adoption can proceed.
