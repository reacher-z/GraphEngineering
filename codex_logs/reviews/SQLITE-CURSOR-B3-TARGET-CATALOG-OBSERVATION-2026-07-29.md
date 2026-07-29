# SQLite B3 target physical-catalog observation closure — 2026-07-29

## Outcome

The package-private target physical-catalog observation leaf is complete. It
reads the exact SQLite v2 owned-object projection, converts SQLite's raw SQL
text into the frozen canonical inventory, and separates ordinary diagnostic
observation from exact target validation. It does not mint a receipt, fence,
lease or authority and is not exported from the SQLite package root.

The implementation lives in
`packages/sqlite/src/cursor-publication-target-catalog.ts`. Its closed native
read trust root is implemented package-privately in
`packages/sqlite/src/sqlite-connection.ts`. The hostile oracle lives in
`packages/sqlite/test/cursor-publication-target-catalog.test.ts`.

## Frozen protocol identity

- Catalog query:
  `SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`.
- Query SHA-256:
  `bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
- Digest domain: `graph-engineering/sqlite-target-physical-catalog/v1\0`.
- Expected row count: 34.
- Expected canonical UTF-8 bytes: 5,785.
- Expected catalog SHA-256:
  `ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
- Expected application ID: `1195724359`.
- Expected user version: `2`.
- Every one of the 34 ordered
  `type:name:tableName:exactSqlSha256` inventory entries is frozen and checked
  independently of the aggregate digest.

Canonical rows use the exact key order `name`, `sqlSha256`, `tableName`,
`type`. SQLite SQL text is hashed byte-for-byte as UTF-8; no whitespace or
Unicode normalization is performed. Database order is the protocol order and
the runtime never sorts it.

## Observation and validation separation

`snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic` returns a
plain deeply detached frozen data value. It can describe hostile or incomplete
catalogs for diagnostics. It is not placed in a WeakMap, branded as proof or
accepted as authorization.

`validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic` performs
the explicit target acceptance step. It checks application/user versions,
row count, canonical bytes, aggregate digest, query digest and every inventory
entry. Shape errors are structured invalid-argument failures; a well-shaped
but non-target physical catalog is structured corruption.

## Captured native read trust root

The connection owner exposes only two closed-set package-owned read kinds:
target catalog and target metadata. Callers cannot submit raw SQL through this
seam. The catalog query has an explicit `main.sqlite_schema` source. Metadata
uses `main.pragma_application_id()` and `main.pragma_user_version()`, so TEMP
tables with the same names cannot shadow or forge the versions.

The connection module captures native `DatabaseSync.prepare`/`close`, all four
StatementSync hardening setters, StatementSync `get`/`iterate`, and
`Reflect.apply`. The first real SQLiteConnection initializes the otherwise
unexported iterator `next`/`return` intrinsics without opening a database at
module import. Capture walks the prototype chain, rejects Proxy and bound/JS
wrappers, requires exact native function source, and executes a two-step
false-then-true iterator brand probe before caching. A same-name foreign native
`next` fails construction with a structured internal error and cannot poison
the cache.

Constructor cleanup uses the captured native close, preserves its primary
error over cleanup failure, and relies on SQLite's instance-own,
non-configurable `isOpen` accessor. Normal close and target cursor retirement
also bypass mutable native prototypes.

## Resource, ambient and hostile closure

- The catalog iterator fetches at most 35 rows: the exact 34-row target plus
  one bounded hostile-extra witness.
- Every acquired iterator is closed exactly once. Row/fetch failure remains
  primary over close failure; native failures are translated into the provider
  taxonomy.
- Descriptor-based input inspection rejects sparse arrays, subclasses,
  proxies, revoked proxies, accessors, symbols, inherited or extra fields,
  wrong scalar types and lone surrogates without invoking caller traps.
- Canonical construction uses explicit indexed loops and captured
  `Object.defineProperty`; hostile Array `includes`/`push`/`join`/iterator and
  numeric-index setters cannot alter rows, inventory or digest.
- Post-capture replacement of DatabaseSync, StatementSync, iterator and
  `Reflect.apply` methods is ignored by the production path.
- Uppercase and mixed-case owned views/triggers enter the projection;
  unrelated objects do not.
- A sequential isolated module-reset oracle proves that poisoning the native
  iterator prototype before the first connection is rejected rather than
  captured.

## Verification on final bytes

- Target catalog focused suite: 19/19 passed.
- Target catalog plus SQLite connection suites: 38/38 passed.
- B3 fixture/conformance suite: 34/34 passed and the validator reported
  `implementationClaim: false`, `activeManifestClaim: false`.
- Complete SQLite package suite: 26 files, 891/891 tests passed.
- Workspace typecheck: passed across all eight implementation packages.
- Workspace lint: passed across all eight implementation packages.
- Whitespace/additions checks: passed.
- Independent final production/test audits: HIGH 0 / MEDIUM 0 / LOW 0.

An earlier full-suite run overlapped workspace typecheck/lint and caused two
five-second timing failures. Both affected files passed 246/246 immediately
when run without CPU contention, and the final uncontended complete suite
passed. The timing run is not treated as acceptance evidence.

## Nonclaims and next authorized boundary

This leaf does not prove migration `0002` executed. It does not advance the
outer authority epoch, `total_changes` watermark or permanent-write ledger.
It does not mint `migration0002CatalogRebuildReceipt`, a post-DDL fence, reader
lease, reader terminal proof or any of the later three initial-write receipts.
It performs no DDL, DML, transaction control, TEMP projection read, adoption,
cursor rebind, rule 11/12 evaluation or commit.

The next authorized production tranche is the exact sequential migration
`0002` asset verifier/executor together with the authentic migration receipt
and atomic outer-authority epoch/change/ledger transition. A fresh independent
catalog read may become a receipt-bound fence only after that transition.
