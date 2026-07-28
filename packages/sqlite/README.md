# `@graph-engineering/sqlite`

Same-host durable SQLite implementation of the provider-neutral Graph
Engineering CycleStore contract.

> Alpha status: use this package for one-host, local-filesystem deployments and
> evaluation. It is not a PostgreSQL substitute, a multi-host lock service, or
> a release-readiness claim.

## Install and runtime floor

Install `@graph-engineering/sqlite` together with the version-aligned
`@graph-engineering/runtime` and `@graph-engineering/core` packages. The npm
package requires Node.js `>=22.16.0`.

The implementation uses Node's built-in `node:sqlite` `DatabaseSync` and online
backup APIs. On the Node 22 line, `node:sqlite` is marked active development and
emits an experimental warning unless warnings are disabled. Pin and test the
exact Node 22.x version used in production; the package floor does not turn the
underlying Node API into a stable platform guarantee.

Python users install the version-aligned `graph-engineering` distribution. Its
SQLite adapter uses the Python 3.11+ standard-library `sqlite3` module. See the
[complete SQLite operator runbook](../../docs/SQLITE.md) for the Python surface.

## Supported deployment shape

- One file-backed database on a local filesystem.
- All writers on one host and in the same SQLite filesystem-locking domain.
- Multiple local processes are supported through SQLite WAL locking and
  `BEGIN IMMEDIATE` transactions.
- Network filesystems, SMB/NFS shares, distributed volumes, synchronization
  folders, and multi-host writers are unsupported.
- `distributedFencing` is intentionally `false`.
- Payload and at-rest encryption are external responsibilities.

Do not place the database on a network filesystem merely because every client
can see the same path. SQLite file locks are not a distributed consensus or
fencing protocol.

## Quick start

The retained [Node quick start](../../examples/sqlite/node-quickstart.mjs)
creates a temporary database, appends and replays one operation, inspects the
schema, exercises the migration lock, performs a semantic audit, makes an
online manifest-bound backup, restores to a new path, and removes its temporary
directory.

From a repository checkout, build the three leaf packages and run it:

```sh
corepack pnpm --filter @graph-engineering/core build
corepack pnpm --filter @graph-engineering/runtime build
corepack pnpm --filter @graph-engineering/sqlite build
node --no-warnings examples/sqlite/node-quickstart.mjs
```

The same public imports used by the retained example are available from the
published package root:

- `SQLiteCycleStoreProvider`
- `createSQLiteCycleStoreBackup`
- `restoreSQLiteCycleStoreBackup`
- `inspectSQLiteCycleStoreIntegrity`
- the fixed provider, schema, migration, descriptor, and manifest identities

Package-private connections, SQL helpers, codecs, and raw migration executors
are deliberately not exported.

## Constructor and lifecycle

Construct `new SQLiteCycleStoreProvider(databasePath, options)` only with an
application-owned local path whose parent already exists. The durable provider
rejects `:memory:`. Use a `try`/`finally` and call `close()`; close is idempotent,
and every later operation fails with a typed lifecycle error.

The development default authorization hook allows requests; it is not a
production tenant policy. Multi-tenant deployments must inject a deny-by-
default `authorize` hook backed by their own policy and identity system.

The bounded Node options are:

| Option | Default | Meaning |
| --- | ---: | --- |
| `busyTimeoutMs` | 250 | SQLite connection busy wait |
| `maxBusyAttempts` | 3 | complete `BEGIN IMMEDIATE` transaction attempts |
| `maxBusyElapsedMs` | 1,500 | total retry elapsed-time cap |
| `authorize` | allow hook | authorization hook called before existence queries |
| `now` | SQLite UTC | deterministic test hook only; do not inject a production clock |
| `faultHook` | absent | test-only crash-boundary hook |

The timeout multiplied by the attempt limit must fit inside the elapsed-time
bound. Only numeric SQLite BUSY/LOCKED classes retry. Each retry restarts the
whole transaction at ledger lookup; constraint, conflict, corruption,
permission, full-disk, and unsupported-version failures never enter that loop.

## Synchronous JavaScript boundary

`SQLiteCycleStoreProvider` methods return promises because authorization hooks
may be asynchronous and because they implement the shared async provider
interface. The database calls themselves use `DatabaseSync` and block the
calling JavaScript thread, including a bounded busy wait. A promise return type
does not make the database work nonblocking.

For latency-sensitive servers, own the complete provider inside a dedicated
Node Worker Thread and message it through a bounded application queue. Do not
move one transaction across threads or share one provider instance as if it
were an asynchronous connection pool.

## Connection policy and WAL files

Construction establishes and reads back these invariants before serving work:

- file-backed SQLite `>=3.37.0` with `STRICT` table support;
- WAL journal mode;
- `synchronous=FULL`;
- foreign keys on;
- trusted and writable schema off;
- extension loading and double-quoted string literals disabled;
- busy timeout set to the bounded constructor value; and
- WAL autocheckpoint at 1,000 pages.

An open store can have `cycle-store.db`, `cycle-store.db-wal`, and
`cycle-store.db-shm`. The sidecars are part of the live database state. Their
presence and lifetime vary with connections and checkpoints. Never delete,
move, archive, or copy a sidecar independently while a provider is open.

A long-lived reader can prevent WAL truncation. Monitor database and WAL byte
sizes as operational metrics, remove the stuck reader, then allow a normal
checkpoint. Do not treat an unthrown checkpoint call as success unless its
returned busy status is zero.

## Online backup, manifest, audit, and restore

Never make a live backup with a raw filesystem copy of the main `.db` file. A
committed transaction may exist only in `-wal`, so the raw copy can silently
lose acknowledged records.

`createSQLiteCycleStoreBackup(sourcePath, newBackupPath)` uses SQLite's online
backup API, bounds progress and elapsed time, closes and reopens the candidate,
runs physical and semantic audits, hashes the closed file, writes a
content-addressed `<backup>.manifest.json`, syncs publication, and refuses a
source alias or existing target.

`restoreSQLiteCycleStoreBackup(backupPath, newDatabasePath)` verifies the
manifest and complete semantic identity before publishing only to a new empty
path. It never overwrites a live store. After restore, open the result as a new
provider and verify the expected schema, stream tail, lease/migration fences,
operation replay, and application-level sentinel.

Rollback is a deployment decision: stop writers, keep the failed source as
evidence, verify a separate database, and switch the application's configured
database path. To roll back that switch, stop writers and select the previously
verified path. Do not mutate or restore over either database in place.

The three audit levels are:

- `quick`: SQLite quick check, foreign keys, identity, and counters;
- `structural`: full SQLite integrity plus schema structure;
- `semantic`: all authoritative canonical blobs, hashes, record chains, heads,
  operation results, checkpoints, fences, holds, cursors, and migration state.

Use semantic mode for every backup/restore drill and before selecting a
database for rollback.

## Migration locking and schema inspection

`inspectSchema(context)` reports version compatibility, descriptor identity,
and the current migration lock. `acquireMigrationLock`,
`inspectMigrationLock`, and `releaseMigrationLock` provide an exclusive,
monotonic, fenced operator decision. While an incompatible live migration lock
exists, online mutations fail closed after exact idempotency replay.

The lock is not a caller-controlled SQL migration endpoint. Migration SQL is a
reviewed package asset; callers cannot supply SQL, PRAGMA names, `ATTACH`
paths, identifiers, or extensions. A stale or reused lock identity cannot
publish a schema transition. Version 0 to version 1 is the only current alpha
migration; unknown future versions fail closed. There is no in-place downgrade.

## Ambiguous commit and cancellation

A process crash, lost response, Worker termination, or cancellation can occur
after SQLite commits but before the caller receives the result. In that state,
retry the exact captured request with the exact same `operationId`. The durable
operation ledger returns the original result without duplicating the mutation.

Never generate a replacement operation ID for an ambiguous outcome. Never
change any request byte under the old ID: a changed request or operation name
returns `GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT`.

## Corruption response and checkpoints

On `GE_CYCLE_STORE_CORRUPTION`, stop writers, retain the database and sidecars
without placing them in logs, run a read-only audit if safe, and restore a
verified backup to a new path. Do not repair canonical blobs, hashes, SQLite
catalog rows, or migration metadata by hand.

Checkpoints are disposable accelerators, never authoritative history. The S02
adapter detects and reports bad checkpoints. Automated fallback to a full event
fold belongs to D7-S04 and is not yet integrated, so applications must not
silently continue from a corrupt checkpoint.

## Payload protection and safe telemetry

The adapter stores canonical application payloads exactly as submitted. It
does not encrypt, redact, classify, or inspect them. Encrypt or wrap sensitive
values before `createCycleStoreRecord`/`createCycleStoreCheckpoint`, and use
host-level encrypted storage and protected backups. Do not place secrets in
tenant, stream, record, checkpoint, lease, hold, lock, or operation IDs.

Safe telemetry is limited to fixed operation/result classes, hashed tenant
identity, byte/page counts, bounded retry class/count, and coarse duration
buckets. Never log payloads, canonical blobs, cursor tokens, authorization
contexts, raw IDs, database paths, SQL, bound parameters, SQLite messages,
exception causes/stacks, `expandedSQL`, manifests containing deployment paths,
or database/WAL contents.

## Benchmark characterization

The benchmark has no throughput pass/fail threshold. Full mode measures the
retained 10-category plan, including 10K/100K semantic audits; quick mode scales
those two setup sizes to 128/1,024 records and labels the scale-down in output.
Both modes emit raw samples, nearest-rank p50/p95/p99, Node and discoverable
Python versions, linked SQLite and filesystem metadata, settings,
database/WAL/SHM sizes, contention results, retry observability, and hot-index
`EXPLAIN QUERY PLAN` assertions.
Prebuilt record/checkpoint fixtures are outside append/save timers; provider
capture, validation, authorization, transaction, ledger, and decode remain
inside them.

```sh
node --test tools/benchmarks/sqlite_cycle_store.test.mjs
node tools/benchmarks/sqlite_cycle_store.mjs --quick
node tools/benchmarks/sqlite_cycle_store.mjs
```

Do not publish one developer-machine result as production throughput. Establish
several stable, comparable baselines before proposing any generous regression
guardrail.

## Explicit remaining blockers

This package does not complete:

- D7-S03 PostgreSQL, multi-host fencing, failover, or point-in-time recovery;
- D7-S04 checkpoint acceleration and verified full-fold fallback;
- D7-I01/I02 scheduler revision protocol and durable scheduler integration;
- complete 54/36-case, crash, interop, artifact, and independent acceptance
  evidence for one immutable candidate; or
- release authorization, publication, support readiness, or any Star/popularity
  outcome.

See [SQLite operations and threat model](../../docs/SQLITE.md) for the full
runbook and nonclaims.
