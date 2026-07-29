# SQLite B3 post-DDL dependency audit — 2026-07-29

## Decision

Three independent read-only reviews found a batch-order cycle in the delivery
sequence, not an object-level protocol cycle. The post-DDL physical-catalog
fence must bind the exact migration-`0002` receipt. The reader lease must bind
that fence. The remaining baseline-entry/header/sequence receipts then depend
on the reader terminal proof and fence. Therefore the original batching
“fence+reader, then all four receipts” cannot be implemented honestly.

The corrected object DAG is:

1. portable digest codec and active outer authority;
2. pure, non-authorizing target-catalog observation codec;
3. verified `0002` asset execution, outer ledger/watermark advance and authentic
   migration receipt;
4. post-DDL catalog observation plus exact receipt-bound fence mint;
5. one-shot reader lease and terminal proof;
6. baseline entries, header and sequence-zero receipts; and
7. atomic four-receipt stage adoption.

No placeholder receipt, test-only registry insertion, structurally similar
object or fresh-v2 catalog snapshot may stand in for the authentic migration
receipt.

## Superseding catalog identity

The old master-plan prose used `name GLOB 'ge_cycle_*'` and query digest
`eb165659...`. The current case/schema/protocol contract supersedes it with:

`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`

Its SHA-256 is
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
The lowercase prefix is security-significant: uppercase and mixed-case owned
views/triggers must enter the projection and change its digest.

The accepted target observation is exactly 34 rows, 5,785 canonical UTF-8
bytes, application ID `1195724359`, user version `2` and domain-separated
catalog digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
Every row contains `name`, exact SQLite SQL text SHA-256, `tableName` and `type`.
SQL text is hashed exactly without whitespace normalization. Null-SQL
autoindexes and unrelated objects are outside the projection.

## Authorized immediate leaf

Only a package-private, non-authorizing target-catalog observation module may
be built before the authentic migration receipt. It may freeze constants,
decode the exact four-column result, hash exact SQL text, serialize the rows,
validate inventory/count/bytes/digest/application/user versions and return a
plain diagnostic snapshot.

It must not mint or call its result a fence, advance the outer authority,
execute or import `0002`, expose write authority, mint a reader lease, be
accepted by a writer/adoption bridge, run DML, rebind a cursor or control a
transaction. Its output is evidence for testing and a future internal building
block, not an opaque protocol capability.

## Existing-code reuse constraints

- Captured SQLite connection owner, `total_changes` and prepare intrinsics may
  be reused where the final receipt-bound implementation needs them.
- The existing v1 migration catalog hash cannot be reused: it selects a
  different object set and normalizes whitespace.
- The existing pre-B2 ordered TEMP handoff reader cannot be reused as the
  post-DDL lease: it binds the old epoch/change fence and has a different
  lifecycle.
- The fixed B2 TEMP SELECT and its row/hash-chain logic may be studied, but no
  post-DDL reader authority is minted before the fence exists.

## Nonclaims

This audit and the next catalog codec do not execute a migration, prove that
`0002` ran, mint a write receipt/fence/reader proof, or close any formal RC
gate. They preserve the three-day source-preview acceleration while refusing
to manufacture evidence that the dependency graph does not yet support.
