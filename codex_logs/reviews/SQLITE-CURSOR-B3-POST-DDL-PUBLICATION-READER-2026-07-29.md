# SQLite Cursor B3 post-DDL publication reader review — 2026-07-29

## Scope

This record covers only the TypeScript post-DDL publication reader lease and
its terminal proof. The leaf starts from the already committed exact migration
0002 receipt and fresh post-DDL physical-catalog fence. It stops before any
baseline-entry/header/sequence write, receipt consumption, stage adoption,
cursor rebind, TEMP retirement or outer commit.

The implementation remains package-private. No reader capability or intrinsic
is exported from `@graph-engineering/sqlite`'s package root.

## Implemented authority and lifecycle

- Added the fixed zero-parameter TEMP source query to the connection-owned
  captured-native read allowlist.
- Bound the reader to the exact outer authority, connection, transaction
  lineage, TEMP stage, stage transfer, migration-0002 receipt, post-DDL fence,
  B2 projection identity and opaque projection-reference identity.
- Implemented one opaque lease with lifecycle
  `minted-unused -> reader-active -> reader-closed -> retired`, plus terminal
  `poisoned` failure state.
- Recorded prepare, execute, ownership-acquisition, fetch-attempt and close-
  attempt counters independently.
- Recomputed the fixed SQL SHA-256 before prepare and reproved the post-DDL
  catalog, epoch, `total_changes` and three-dimensional ledger before prepare
  and after close.
- Revalidated every exact four-column row, canonical key/state byte carrier,
  rank/order relation and complete baseline projection.
- Retained canonical entries privately only after exact-one successful close
  and the post-close fence. The lease itself is the reusable terminal proof.
- Added a dedicated stage-owned cleanup slot separate from the old B2 ordered
  handoff. Direct stage disposal, stage poison, outer poison and retirement all
  encounter the same idempotent close callback before TEMP cleanup.
- Preserved error precedence: row/terminal primary, close failure, live
  authority/fence/watermark failure, cancellation, then ordinary cleanup.
- Kept valid preownership cancellation retryable with zero reader counters;
  all postownership cancellation paths close once and poison.
- Hardened retained-entry construction against mutable array setters/species,
  accumulator prototype replacement, mutable `Buffer.from` and mutable
  `Object.freeze`.

## Adversarial review findings and remediation

Three independent lanes reviewed the production and test diff. Findings were
fixed before acceptance:

1. Cancellation was initially sampled before validating the row returned by
   `next()`. It now samples only after the current row or terminal result has
   been validated, so row/terminal corruption remains primary.
2. Terminal-only cancellation initially lacked a locked test. The reader now
   finishes the projection, closes once, records proof diagnostics and then
   rejects cancellation without minting a terminal proof.
3. Preownership cancellation initially preceded the live fence/watermark gate.
   Cancellation object provenance is still checked early, but a cancelled bit
   is honored only after authority, SQL and watermark validation.
4. Postownership cancellation initially preceded the post-close fence. The
   post-close live authority/catalog/ledger gate now runs before cancellation,
   so rollback, unexplained writes and stage disposal cannot be masked.
5. A captured `Array.prototype.push`/`slice` was insufficient against inherited
   numeric setters and `Symbol.species`. Canonical entries are now installed as
   own indexed properties through captured `Object.defineProperty`, counted
   independently and frozen in place without slice/species construction.
6. Canonical entry getters used mutable `Buffer.from`, and accumulator output
   used mutable `Object.freeze`. The operation-baseline module now captures the
   relevant Buffer/Object intrinsics before hostile replacement.
7. The first post-close gate checked only the outer authority. It now performs
   a fresh exact post-DDL catalog-fence assertion before the lease can retire.

Final independent static audit on the remediated byte set reported:

- HIGH: 0
- MEDIUM: 0
- LOW: 0

## Executed validation

All commands ran from `/home/nick/work/GraphEngineering` unless noted.

### Focused and full SQLite tests

- `corepack pnpm --filter @graph-engineering/sqlite exec vitest run test/cursor-publication-post-ddl-reader.test.ts`
  - PASS: 1 file, 35 tests.
- Combined reader, outer-authority and connection suite with one worker
  - PASS: 84 tests.
- `corepack pnpm --filter @graph-engineering/sqlite test`
  - PASS: 27 files, 942 tests.
  - Full parallel wall time: 320.46 seconds.
- SQLite Vitest retains a finite 15-second per-test timeout. The previous
  5-second default was below observed full-package resource-contention latency
  for several real-SQLite campaigns; no assertion was weakened or skipped.

### Frozen B3 and migration contract

- `corepack pnpm test:sqlite-ledger-contract`
  - PASS: 61 tests and every chained validator.
  - B3 hostile obligations/records remain 145/145.
  - `implementationClaim: false`.
  - `activeManifestClaim: false`.
- `corepack pnpm check:sqlite-migrations`
  - PASS: source/mirror/preview/Python support assets and six negative release
    tests.

### Workspace and package gates

- `corepack pnpm typecheck`
  - PASS: all eight implementation packages.
- `corepack pnpm lint`
  - PASS: all eight implementation packages.
- `corepack pnpm check:packages`
  - PASS: eight npm manifests/tarball content sets; private leak guard passed.
- `corepack pnpm check:packed-install`
  - PASS: eight packed pnpm tarballs installed and smoke-tested.
- `uv build --project python --out-dir python/dist`
  - PASS: rebuilt wheel and sdist from the current repository byte set.
- `corepack pnpm check:python-package`
  - PASS after the rebuild: 71 wheel entries and 72 sdist entries; wheel/sdist
    install, entry points, shared YAML authoring, validate and doctor passed.
  - The first check correctly rejected stale local artifacts whose quickstart
    asset predated the current repository quickstart. No false green was
    recorded; artifacts were rebuilt before the passing check.
- `git diff --check`
  - PASS for the integrated scoped diff.

## Append-only plan integrity

The committed master plan at the start of this tranche contained 14,526 lines
with SHA-256
`ce363ba18336597c09086009c9d4958e8c936811fe698212ba409f9856a011a8`.
Section 31.37.30 was appended without changing those lines. The first 14,526
lines of the working plan recompute to the same SHA-256. The plan now contains
14,695 lines and its diff is additions-only for this tranche.

## Honest nonclaims and next dependency

This evidence does not complete B3, Graph Engineering or the 21-day master
plan. It does not claim a production-ready v2 database, public manifest v2,
Python reader parity, four-receipt adoption, cursor migration/rebind, rules
11/12, TEMP retirement, crash/reopen v2 acceptance, stable release, external
adoption or a GitHub star outcome.

The only newly authorized dependency leaf is the baseline-entry publication
receipt. That writer must consume the private canonical entries from this
exact terminal lease, perform no second TEMP read, execute the fixed one-
prepare/E-run INSERT, advance the three-dimensional outer ledger exactly and
mint one authentic non-consumed receipt before header/sequence/adoption work.
