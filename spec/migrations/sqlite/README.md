# Canonical SQLite CycleStore migrations

This directory is the authoritative cross-language source for the local
SQLite CycleStore schema. TypeScript and Python adapters consume byte-identical
copies of these assets; they must never construct migration SQL from caller
data.

## Asset inventory

- `schema-v1.sql` creates a fresh version-1 logical schema. It deliberately
  does not insert the schema singleton or migration ledger row: the adapter
  binds the reviewed manifest hashes and its validated provider descriptor by
  prepared statement inside the same exclusive bootstrap transaction.
- `schema-v1.identity.json` freezes the required table, column, index, BLOB,
  and tenant-scope inventory. Its domain-separated canonical JSON hash is the
  schema identity recorded in `manifest.json`.
- `0001-alpha-v0-to-v1.sql` is the only supported upgrade. It rebuilds the two
  changed v0 tables, preserves all authoritative carriers and fences, seeds
  checkpoint revision history, and adds migration and cursor state.
- `fixtures/alpha-v0.sql` is the immediately previous repository-defined alpha
  fixture. It contains two tenants with colliding public IDs, a multi-record
  chain, checkpoint, active and released lease histories, used IDs, legal hold,
  operation ledger, and released migration-fence history.
- `validate.mjs` and `migrations.test.mjs` verify bytes, manifest closure,
  fresh bootstrap, upgrade, rollback, reopen, and hostile mutations.

All text assets are UTF-8 without BOM, use LF only, and end in exactly one
newline. The manifest records SHA-256 over the exact repository bytes.

## Required executor protocol

The adapter must reject an unknown application ID, unknown future version,
missing intermediate migration, changed applied hash, or incompatible live
migration before executing DDL. For the v0→v1 path it must:

1. configure and read back connection safety settings outside a transaction;
2. run a complete v0 semantic preflight and verify the fixture-independent
   source shape;
3. execute `BEGIN EXCLUSIVE` and re-read the application, version, schema, and
   migration-fence decision;
4. execute the exact migration bytes, without interpolation;
5. replace the two all-zero schema sentinels using prepared values from the
   verified manifest, set the provider application time, and insert the exact
   `ge_cycle_migrations` row using a canonical BLOB of required postconditions;
6. verify every manifest postcondition before `COMMIT`; and
7. roll back on any error, leaving both schema and `user_version` at zero.

The all-zero hashes in the migration are intentionally invalid serving state.
Opening version 1 with either sentinel, a missing ledger row, or a changed
applied SQL hash must fail closed as corruption/unsupported version.

Fresh bootstrap follows the same rule: execute `schema-v1.sql` under one
exclusive transaction, insert one manifest-bound schema singleton and one
version-1 migration lineage row by prepared statement, initialize the released
migration-lock singleton, verify all postconditions, then commit.

## Persistence boundaries

Every authoritative JSON carrier is stored as canonical UTF-8 bytes in a BLOB.
TEXT is limited to validated identifiers, lowercase SHA-256 values, fixed
enums, and public timestamps. Every online identity, uniqueness boundary, and
foreign key is tenant-scoped; schema and migration metadata are intentionally
global singletons. Checkpoint revisions and used lease/lock IDs are append-only
history and must not be collapsed into the mutable current-state rows.

This schema provides local-file, same-host transaction fencing only. It does
not establish multi-host fencing, safe network-filesystem use, transparent
encryption, checkpoint authority, or permission to raw-copy a live WAL file.
There is no in-place downgrade: development rollback rebuilds a new database
from a separately verified backup.
