# SQLite CycleStore operations and threat model

This runbook covers the TypeScript and Python `sqlite-local` CycleStore
providers. It describes the alpha support boundary, safe lifecycle, WAL and
transaction behavior, integrity and recovery procedures, benchmark evidence,
and known blockers. The canonical protocol remains in `spec/`; this document
does not expand the provider contract.

## Status and nonclaims

The SQLite provider is designed for durable Graph Engineering state in a
single-host deployment. It persists event records and stream heads, the mutation idempotency
ledger, checkpoints, leases and monotonic fences, legal holds, migration lock
state, pagination cursors, and schema identity in one file-backed database.

The alpha does **not** claim:

- multi-host or network-filesystem fencing;
- PostgreSQL availability, failover, row-level writer concurrency, or
  point-in-time recovery;
- encryption at rest or payload redaction from stock SQLite;
- nonblocking database I/O from an async-looking method;
- checkpoint authority or automatic checkpoint-corruption fallback;
- a legal deletion, archival, or physical compaction API;
- scheduler integration or release readiness; or
- any adoption, Star, or popularity outcome.

`distributedFencing` is `false`. SQLite serializes local writers through file
locks; it does not provide distributed consensus.

## Supported runtimes

| Runtime | Floor | Database API | Important status |
| --- | --- | --- | --- |
| TypeScript | Node.js 22.16.0 | built-in `node:sqlite` | `DatabaseSync` and online backup are used; on Node 22, `node:sqlite` is active development and may emit an experimental warning |
| Python | CPython 3.11 | standard-library `sqlite3` | one provider-owned connection runs on a dedicated worker thread; Python 3.11 legacy and 3.12+ transaction behavior use the same explicit SQL boundaries |
| SQLite | 3.37.0 for the Node adapter | file-backed WAL database | `STRICT` tables are required; the actual linked SQLite version is recorded by audits and benchmarks |

Pin and test the exact runtime builds used by a deployment. The Node package's
version floor does not promote the underlying active-development `node:sqlite`
surface to stable. Python remains at the repository-wide `>=3.11` floor.

Install the version-aligned npm packages `@graph-engineering/core`,
`@graph-engineering/runtime`, and `@graph-engineering/sqlite`, or the
version-aligned Python `graph-engineering` distribution. Do not mix alpha
versions or migration assets from different builds.

## Retained, temporary-path examples

The examples create their databases and backups under a runtime-generated
temporary directory, close every provider, and remove only that exact
directory. They contain no destructive wildcard and no fixed user path.

Run the Node example from a repository checkout:

```sh
corepack pnpm --filter @graph-engineering/core build
corepack pnpm --filter @graph-engineering/runtime build
corepack pnpm --filter @graph-engineering/sqlite build
node --no-warnings examples/sqlite/node-quickstart.mjs
```

Run the Python example in the locked project environment:

```sh
uv run --project python python examples/sqlite/python_quickstart.py
```

The examples are executable counterparts for the lifecycle and administration
procedures below. They append one record, inspect schema identity, acquire and
release the migration lock, run a semantic audit, create an online backup and
manifest, restore to a new path, reopen, read, and prove exact operation replay.

## Deployment boundary and path ownership

Use a normal local filesystem whose locking and durability semantics are known
for the host. Every writer must use the same host and SQLite locking domain.
The application or operator must own the database parent directory and choose
a fixed database path before construction.

Unsupported placements include:

- NFS, SMB/CIFS, distributed or clustered filesystems;
- cloud-sync and desktop synchronization folders;
- FUSE mounts without explicitly proven SQLite locking and sync semantics;
- container replicas on a shared volume from different hosts; and
- any design that treats a shared pathname as distributed fencing.

Keep caller-controlled strings out of filesystem path selection. The provider
binds tenant/stream/operation values as SQL parameters, but that does not make
an untrusted database pathname safe. Use an application-owned configuration
entry, a pre-created local parent, and OS permissions that exclude unrelated
principals.

The durable provider rejects an in-memory database. Backup and restore paths
must have an existing local parent and be new. Backup/restore administration
rejects source symlinks, source/destination aliasing, and target overwrite.
Do not race path validation with an untrusted process that can replace files
or parent directories.

## Lifecycle and threading

### Node

One `SQLiteCycleStoreProvider` owns one `DatabaseSync` connection. Construct it
with an application-owned path, use it inside a `try`/`finally`, and call
`close()`. Close is idempotent. Calls after close fail with a structured safe
provider error.

The provider methods return promises to implement the shared provider surface
and permit an asynchronous authorization hook. The database work is
synchronous. `DatabaseSync`, a busy timeout, integrity audit, or canonical
decoding can block the JavaScript event loop.

If event-loop latency matters, place the complete provider in a dedicated
Worker Thread behind a bounded message queue. The worker owns construction,
all transactions, backup coordination, and close. Do not pass a live provider
or half of a transaction between threads, and do not describe a Worker wrapper
as an asynchronous SQLite connection pool.

### Python

One `SQLiteCycleStoreProvider` owns one connection and a dedicated one-thread
executor. A per-instance async lock serializes complete operations. Connection
creation, transaction, backup, audit, and close execute on the owning worker;
the event-loop thread does not directly use the connection. Prefer `async with`
or await the idempotent `close()` in `finally`.

This has the same cancellation boundary that applies to
`asyncio.to_thread`: cancelling the awaiting coroutine does not stop the
already-running worker call. It may commit after cancellation. Treat that as
an ambiguous outcome and retry the exact operation ID; never infer rollback
from `CancelledError`.

For compatibility across Python versions, the adapter uses explicit manual SQL
`BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK` rather than relying on version-
specific `Connection.commit()` behavior. The connection is placed in manual
transaction mode compatible with Python 3.11's legacy surface and Python 3.12+
autocommit changes. `check_same_thread=False` is not used as a substitute for
transaction ownership.

## Connection settings and bounded contention

Every writable connection establishes and reads back the required policy
before it serves requests:

- foreign-key enforcement on;
- WAL journal mode;
- `synchronous=FULL`;
- a bounded busy timeout;
- trusted schema off;
- writable schema off;
- extension loading disabled;
- a 1,000-page WAL autocheckpoint; and
- the expected application ID, schema version, and migration manifest.

Node additionally disables double-quoted string literals through the supported
`node:sqlite` constructor surface. A setting readback mismatch fails
construction rather than silently weakening the descriptor.

Default and accepted tuning ranges are:

| Setting | Node default / bounds | Python default / bounds |
| --- | --- | --- |
| connection busy timeout | 250 ms / 0–5,000 ms | 250 ms / 1–60,000 ms |
| whole-transaction attempts | 3 / 1–8 | 4 / 1–16 |
| whole-transaction elapsed cap | 1,500 ms / 0–30,000 ms | 2,000 ms / 1–120,000 ms |
| WAL autocheckpoint | fixed 1,000 pages | 1,000 / 1–1,000,000 pages |

The Node timeout multiplied by its attempt count must fit the elapsed cap.
Tune only from retained workload evidence. A longer timeout raises worst-case
event-loop blocking in Node and lock-denial latency in both runtimes.

Only numeric SQLite BUSY/LOCKED classes can retry. A retry starts a completely
new `BEGIN IMMEDIATE` transaction at durable operation-ledger lookup. It never
resumes after a partial statement. CAS conflict, malformed input, constraint,
corruption, read-only storage, full disk, permission, and unsupported schema do
not enter the lock retry loop.

## Transaction and idempotency model

Every mutation captures and validates the entire request before authorization
awaits or SQL. Authorization runs before existence-revealing queries and
outside a transaction. After authorization, one synchronous decision executes:

1. `BEGIN IMMEDIATE` reserves the writer;
2. the exact `(tenantId, operationId)` ledger entry is read first;
3. a live incompatible migration lock is checked;
4. tail, lease/fence, hold, or operation-specific state is read;
5. compare-and-swap and canonical validation run;
6. authoritative rows and the canonical result ledger are written together;
7. commit completes; and
8. the detached result is returned.

An exception while a transaction is active attempts SQL rollback. Exact
operation replay returns the original durable result, even after restart,
tail advance, lease expiry, checkpoint deletion, legal-hold change, backup, or
restore. Reusing an operation ID with any changed request byte or operation
name returns `GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT` without mutation.

Caller operation IDs are therefore part of the recovery protocol, not merely
tracing labels. Generate them before the first attempt, retain the complete
captured request until its outcome is resolved, and never recycle them.

## WAL and sidecar operations

An open database may consist of:

- `cycle-store.db` — main file;
- `cycle-store.db-wal` — committed pages not yet checkpointed; and
- `cycle-store.db-shm` — WAL shared-memory coordination.

Sidecar presence and size can change as connections open, checkpoint, and
close. Do not delete, rename, copy, upload, or restore any one live component.
A raw copy of only the `.db` file can omit acknowledged commits that still
exist in `-wal`.

Long-held readers can prevent WAL truncation and cause growth. Monitor main,
WAL, and SHM byte sizes. Find and stop the stuck reader or workload, then use a
bounded checkpoint appropriate to the runtime. Python exposes
`checkpoint_wal`; Node relies on the established autocheckpoint policy and
verified backup surface rather than exposing arbitrary PRAGMA execution.

A checkpoint returns a three-value status. A returned nonzero busy field is a
failed checkpoint even if SQLite did not throw. Never delete sidecars to force
recovery.

## Schema inspection and migrations

The canonical, reviewed migration assets ship byte-identically in the npm and
Python artifacts. Caller data never becomes SQL text, a table/index name, a
PRAGMA name, or a migration program.

`inspectSchema` in Node and `inspect_schema` in Python return:

- the exact descriptor hash;
- current schema version;
- minimum and maximum compatible reader/writer versions; and
- the current active migration lock, if any.

The migration-lock operations acquire, inspect, and release one exclusive
monotonic fence. Acquire uses a new lock ID, expected last fencing token,
source/target versions, TTL, and `acquire` or expired-lock `takeover` mode.
Release requires the exact lock ID, owner, and fencing token. Stale and reused
identities fail closed. The retained examples execute the complete operation.

An active incompatible migration lock blocks online mutations after exact
idempotency replay and before new state changes. It does not accept arbitrary
SQL and does not itself perform a caller-authored migration. Version 0 to 1 is
the only repository-defined alpha upgrade. Construction verifies its exact
hash and postconditions under an exclusive schema decision. Unknown future
versions, changed migration bytes, malformed old state, or partial upgrades
fail closed.

There is no destructive in-place downgrade. Rebuild a new database from a
manifest-bound verified backup and select it through the restore/cutover
procedure.

## Integrity audit levels

The Node function `inspectSQLiteCycleStoreIntegrity(path, level)` and Python
method `audit_integrity(level)` expose bounded audits:

| Level | Checks |
| --- | --- |
| `quick` | quick check, foreign keys, application/schema/manifest identity, safe counters |
| `structural` | quick checks plus full SQLite integrity and expected relational structure |
| `semantic` | every canonical authoritative blob, value and record hash, previous-hash chain, stream head, operation result, checkpoint binding/revision, lease and migration fence, legal hold, cursor, schema, and lineage identity |

`PRAGMA integrity_check` alone is insufficient. It does not detect foreign-key
violations, and a page-consistent database can still contain maliciously
changed canonical payload/application hashes. Every evidence backup, restore,
and rollback candidate must pass semantic mode.

Audits are read-only snapshots but can be CPU and I/O intensive and, in Node,
block the invoking thread. Schedule large audits away from latency-sensitive
event loops and record their raw duration rather than hiding them in an
unbounded background task.

## Online backup runbook

Never use `cp`, a file manager, an object-store uploader, or a volume snapshot
of the live main file as the application backup protocol. Use the SQLite online
backup API exposed by the adapter.

### 1. Preflight

1. Confirm source and destination parents are local, trusted, and on storage
   with enough free space.
2. Confirm the destination database and `<destination>.manifest.json` do not
   exist.
3. Confirm the destination does not alias the source through a hard link,
   symlink, or resolved path.
4. Record runtime and SQLite versions, provider descriptor hash, schema
   inspection, database/WAL sizes, and safe operation counters.
5. Run a semantic audit. Stop if it reports corruption or incompatible schema.

### 2. Create and publish

Node calls `createSQLiteCycleStoreBackup(sourcePath, destinationPath, options)`.
Python calls `await provider.backup(destinationPath)`. Both use the native
online backup operation so a live WAL snapshot includes committed pages.

The implementation writes to unique hidden temporary files, bounds page rate,
progress calls, and elapsed time, closes and reopens the result, verifies
SQLite/foreign-key/schema/canonical/hash/fence semantics, computes file and
semantic identities, syncs the completed artifacts, then publishes a new
database and content-addressed manifest without overwrite.

The manifest contains fixed provider/schema/catalog/lineage identities, file
bytes and SHA-256, semantic SHA-256 and safe counters, plus its domain-separated
manifest hash. It contains no event/checkpoint payload or authorization
context. Treat it as integrity metadata, not as authorization to expose the
backup.

### 3. Verify evidence

1. Require both backup and manifest paths to exist as regular files.
2. Compare the returned file and manifest hashes with retained protected
   evidence.
3. Require semantic audit identity and counters to match the source snapshot.
4. Keep runtime version, settings, page/progress counts, elapsed time, and file
   sizes with the evidence.
5. Never log the source/destination path or raw manifest in a public support
   bundle.

An interrupted backup that was not completely published is not evidence. Do
not rename hidden temporary files into place.

## Restore, cutover, and rollback runbook

### 1. Restore only to a new path

Node calls `restoreSQLiteCycleStoreBackup(backupPath, newPath, options)`.
Python calls `await SQLiteCycleStoreProvider.restore_backup(backupPath,
newPath)` and receives the opened restored provider. The default manifest path
is `<backupPath>.manifest.json`.

Restore refuses an existing destination, source alias, symlink source,
manifest drift, file hash/size drift, provider/schema/catalog incompatibility,
or semantic mismatch. It uses the SQLite backup API to publish a separate new
database and reruns the complete semantic audit. It never overwrites the live
store.

### 2. Application verification

Before cutover:

1. open the restored database with the intended runtime;
2. inspect the exact descriptor and schema interval;
3. rerun semantic audit;
4. read known stream heads and application sentinels;
5. replay a retained completed operation using its exact request and ID;
6. inspect lease and migration fence high-water values;
7. verify legal holds and a retained snapshot cursor if the drill includes
   them; and
8. close the provider cleanly.

### 3. Cut over

Stop all writers and readers. Change the deployment's trusted configured
database path/pointer to the separately verified restored path, then restart
one writer and repeat the application verification. Only then resume traffic.
Do not rename a candidate over an open database or merge rows from the failed
source.

### 4. Roll back the cutover

Keep the former database immutable until the new selection is accepted. If
post-cutover verification fails, stop all processes again, select the former
separately verified path in configuration, restart, and verify. Rollback is a
path-selection/deployment decision, not SQL mutation of either source and not
an in-place restore.

## Ambiguous commits, crashes, and cancellation

The following outcomes are ambiguous rather than proof of rollback:

- process death after SQLite commit but before response serialization;
- a lost IPC or HTTP response;
- Node Worker termination around the after-commit boundary;
- Python task cancellation while its executor/to-thread-style call continues;
- timeout imposed outside the provider; and
- host interruption after commit acknowledgement becomes uncertain.

Recover by retrying the **exact same captured request** with the exact same `operationId`.
A before-commit loss converges by performing the mutation; an
after-commit loss converges by replaying the durable result. Mutation and
ledger are one transaction, so the retry must not create a second record,
lease, checkpoint, hold, or fence interval.

Do not change the payload, expected tail, lease binding, TTL, action, or any
context byte. Do not allocate a replacement operation ID until the old outcome
has been resolved. An idempotency conflict is a safety signal requiring
investigation, not permission to bypass the ledger.

## Corruption response

On `GE_CYCLE_STORE_CORRUPTION` or a replaced/not-a-database header:

1. stop every writer and prevent automated retry with new operation IDs;
2. preserve the exact main/WAL/SHM set as restricted evidence without raw
   copying it into logs or tickets;
3. record the typed code, fixed operation class, runtime versions, safe sizes,
   and last known manifest identity;
4. run read-only quick/structural/semantic audit only if it can be done without
   altering evidence;
5. choose a manifest-bound backup, restore it to a new path, and follow the
   complete verification/cutover procedure; and
6. retain the failed source for controlled forensic analysis.

Never edit `sqlite_schema`, canonical blobs, hash columns, ledger rows, stream
heads, or fence values by hand. Do not use `PRAGMA writable_schema`, attach an
untrusted database, load an extension, or delete WAL sidecars as a repair.

Checkpoints are disposable caches. The S02 provider detects checkpoint drift
and returns typed corruption. D7-S04 will implement controller-level validated
fallback to a full authoritative event fold. Until that is integrated and
proven equivalent, the adapter must not silently drop, reinterpret, or recover
from a corrupt checkpoint on the caller's behalf.

## Payload protection and encryption responsibility

SQLite receives the canonical values submitted to the provider. The adapter
does not redact, tokenize, classify, or encrypt event/checkpoint payloads.
Stock SQLite does not make `encryptionAtRest` true.

Application and operator responsibilities are:

- protect sensitive fields before record/checkpoint construction;
- bind any protected envelope to its tenant/stream/record context;
- use host disk/filesystem encryption and protected backup storage as needed;
- control database, manifest, and directory permissions;
- rotate external encryption keys without rewriting authoritative history
  unless a separately specified migration exists; and
- keep secrets out of all IDs and authorization hashes.

An encrypted disk does not replace application-level payload protection, and
an encrypted payload does not replace database file access control.

## Safe metrics and forbidden logs

Recommended low-cardinality metrics:

- fixed provider operation and structured result/error class;
- a one-way hashed tenant grouping approved by the application policy;
- request/result byte-count and record/page-count buckets;
- coarse duration and queue-delay buckets;
- BUSY/LOCKED class, configured retry budget, typed exhausted-attempt count;
- database/WAL/SHM size gauges without a pathname label;
- audit level and pass/fail class; and
- backup page/progress counts and fixed identity-match result.

Never log or attach:

- event/checkpoint values or canonical BLOBs;
- cursor tokens, operation IDs, lease/hold/lock IDs, or raw tenant/stream IDs;
- authorization contexts, principal/authorization hashes, or hook inputs;
- database, backup, manifest, or sidecar paths;
- raw SQL, migration SQL, bound parameters, statement expansion, or
  `expandedSQL`;
- raw SQLite error strings, exception causes, stacks, schema/table/column names
  copied from errors;
- database/WAL/SHM/backup bytes; or
- environment variables, credentials, or filesystem inventories.

Provider errors intentionally translate numeric SQLite classes into a bounded
taxonomy. Preserve the safe typed code and operation; do not replace it with
the underlying exception text.

## Threat and misuse matrix

| Threat or misuse | Implemented boundary | Operator/application obligation |
| --- | --- | --- |
| SQL injection through IDs or JSON | caller values use prepared placeholders; canonical values remain BLOBs | never turn an ID into an identifier or raw SQL outside the provider |
| migration-input injection | only reviewed, hash-bound package SQL executes | do not patch packaged migration bytes or offer caller-authored migration SQL |
| path traversal | provider validates file-backed paths; backup/restore resolve trusted parents | construct paths only from application-owned configuration, not request text |
| symlink or alias substitution | backup/restore reject symlink sources, source aliases, and existing targets | exclude untrusted writers from database and parent directories |
| source equals destination / overwrite | administration fails closed before publication | always choose a new destination and preserve the old store |
| cross-tenant authorization probing | request capture and authorization precede existence lookup; tenant is in storage keys | install a deny-by-default production authorization hook; the development default is not a tenant policy |
| operation-ledger poisoning | global tenant operation ID stores exact operation name/request/result hashes | generate high-entropy IDs, retain exact requests, investigate every idempotency conflict |
| cursor theft, replay, or substitution | random token hash at rest; cursor is tenant/auth/scope/page-size/schema bound and single-use | treat plaintext cursor as a bearer secret and never log it |
| stale lease-owner resurrection | monotonic persisted epoch/fence and exact active binding gate writes | carry the exact current lease binding; never suppress stale-fence errors |
| migration-lock theft | owner/lock identity, epoch/fence, TTL, nonreuse, and takeover rules persist | restrict migration operations and retain fenced operator identity |
| malicious canonical size/depth/UTF-8/hash drift | bounded adapter codec, fatal UTF-8, canonical reserialization, and semantic audit | do not bypass public constructors/codecs or write database rows directly |
| corrupt/replaced SQLite header | application ID/version checks plus NOTADB/CORRUPT translation | stop writers and restore a verified backup; do not initialize over the file |
| read-only, full-disk, quota, or I/O failure | numeric-class safe translation; only BUSY/LOCKED retries | alert on typed failure and free/repair storage outside the provider |
| long reader and checkpoint starvation | WAL size is observable; checkpoint busy status is checked | bound readers, monitor WAL bytes, stop the holder before retrying checkpoint |
| lock denial of service | timeout, attempt, and elapsed caps bound whole-transaction retries | rate-limit principals and keep retry settings bounded |
| cancellation after hidden commit | durable operation ledger resolves exact replay | retry the same request and operation ID; never assume cancellation rolled back |
| raw SQL/error leakage | public surface excludes raw connection/SQL APIs; errors do not project SQLite strings | log only the safe taxonomy and fields listed above |
| untrusted PRAGMA, `ATTACH`, writable schema, or extensions | no arbitrary PRAGMA/ATTACH API; writable/trusted schema off; extensions disabled | do not open a second privileged raw connection against the live store |
| unsafe live raw copy | manifest backup uses SQLite online backup and semantic verification | never use the main file alone as a backup or recovery candidate |

No caller-controlled identifier becomes a SQL identifier. The public adapters
expose no extension loader, arbitrary `ATTACH`, writable-schema toggle, raw
statement execution, or arbitrary PRAGMA endpoint.

## Reproducible benchmark characterization

The retained Node and native Python harnesses each cover the complete
performance-characterization inventory:

1. single-record append;
2. 64-record atomic append;
3. one, two, and four local writer processes;
4. tail read;
5. 256-record event page;
6. checkpoint save and load;
7. lease renew;
8. 10K and 100K record semantic audits;
9. online backup; and
10. restore verification.

They record their native runtime and linked SQLite versions,
platform/architecture/CPU count, filesystem/block metadata, WAL/FULL/busy and
autocheckpoint settings, database/WAL/SHM sizes, raw millisecond samples,
nearest-rank p50/p95/p99, process contention outcomes, and the retry information
observable through the public boundary. Successful internal provider retries
are intentionally reported as `null` because the public adapter does not
expose that internal counter; typed exhausted attempts are recorded. This is
more honest than inventing zero successful retries.

Record/checkpoint fixture construction occurs outside the timed append/save
window. The timed provider call still includes request capture, canonical
validation, authorization, transaction, ledger, and result decoding. Audit
dataset growth also occurs outside the timed audit window. Contention reports
both campaign wall time and every child-process operation sample, so process
startup is visible rather than silently mixed into single-operation latency.

The harness also asserts `EXPLAIN QUERY PLAN` access paths for tenant/stream
tail, record range, operation ID, checkpoint order, lease, legal hold, cursor
token/expiry, and migration lock/fence lookups. These are correctness
assertions, not latency thresholds. The checks exercise the unforced production
query shapes; they do not use `INDEXED BY` to manufacture a preferred plan.

Quick mode is a smoke: it labels 10K/100K audit targets while scaling actual
setup to 128/1,024 records. Full mode uses the real sizes. Neither mode is a
release gate or production throughput claim.

```sh
node --test tools/benchmarks/sqlite_cycle_store.test.mjs
node tools/benchmarks/sqlite_cycle_store.mjs --quick
node tools/benchmarks/sqlite_cycle_store.mjs
node --test tools/benchmarks/python_sqlite_cycle_store.test.mjs
uv run --project python python tools/benchmarks/python_sqlite_cycle_store.py --quick
uv run --project python python tools/benchmarks/python_sqlite_cycle_store.py
```

Store raw JSON output with the exact commit/runtime/filesystem evidence. Do not
publish one machine's percentiles as a product SLA. Only add generous CI
regression guardrails after multiple stable, comparable baselines exist.

## Supply-chain expectations

The npm artifact must be public MIT, version-aligned, side-effect free, and
contain only compiled JavaScript/declarations/maps permitted by policy,
README, LICENSE, and exact runtime migration assets. It must not contain tests,
raw TypeScript, logs, plans, non-runtime fixtures, databases, WAL/SHM files,
backups, manifests from tests, or environment data. Tarball installation must
rewrite workspace dependencies correctly and open a temporary store on Node
22.16 and the current supported 22.x line.

The Python wheel and sdist must contain the public SQLite provider and exact
migration/manifest assets, preserve sorted public imports, and pass a temporary
open/append/restart/read smoke in isolation. Inventories must prove no test
database, WAL/SHM, backup, log, plan, or environment leakage.

These are release requirements, not claims that any arbitrary checkout or
unpublished artifact already satisfies them.

## Remaining blockers

The v1 adapters now retain the shared 54-case campaign, exact 36-case SQLite
campaign, native crash/concurrency/backup/migration evidence, bidirectional
same-file interoperability, and installed-artifact smokes. SQLite S02 still
requires the appended operation-ledger semantic closure: schema v2 canonical
request BLOBs, a global contiguous commit sequence, normalized legacy
baseline, deterministic replay, physical reconciliation, and the exact
96-case campaign. It then requires immutable-candidate verification,
independent hostile review, and zero remote divergence.

Even after that evidence, these remain separate work:

- **D7-S03 PostgreSQL:** real multi-host database fencing, availability,
  failover, and database-specific chaos evidence;
- **D7-S04 checkpoint acceleration:** controller fast path, corruption fallback
  to full fold, equivalence proofs, and performance evidence;
- **D7-I01/I02 scheduler integration:** revision protocol, accepted-patch
  handoff, pause/resume behavior, and exactly-once scheduler application;
- **release program:** protected operator views, complete artifact/provenance/
  SBOM/secret/license checks, immutable release candidate, independent
  acceptance, publication, and support readiness.

SQLite success alone does not authorize distributed-fencing,
checkpoint-authority, scheduler-integration, release, production-throughput,
or popularity claims.
