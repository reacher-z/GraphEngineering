# CycleStore provider semantics v1alpha1

Status: executable alpha contract. The schema, native reference models, and
54-case differential campaign are normative together. Schema acceptance alone
is not provider conformance or production-durability evidence.

The portable descriptor is
[`cycle-store-provider.schema.json`](cycle-store-provider.schema.json). The
closed campaign is
[`conformance/cycle-store-provider.case.json`](conformance/cycle-store-provider.case.json).
The contract identity is `cycle-store-provider/v1alpha1`.

## Purpose and boundary

A cycle controller owns business semantics: legal event types, state-machine
transitions, budgets, graph revisions, and which event should be emitted next.
A CycleStore provider owns storage semantics: compare-and-swap, immutable
bytes, idempotency, pagination, checkpoint caching, tenant isolation, leases,
fences, and migration exclusion.

These boundaries must not collapse. A database adapter does not reinterpret a
`DiscoveryCommitted` event or decide whether a graph patch is legal. The
controller validates that meaning before constructing a provider record. The
provider then guarantees that the exact record carrier is committed once, in
the exact stream position requested, or not committed at all.

The in-memory TypeScript and Python implementations are deterministic
executable oracles. They are intentionally process-local and non-durable. They
prove the state machine and cross-language byte identity; they do not prove
fsync, process-loss recovery, multi-host fencing, database failover, backup,
restore, or operational retention.

## Descriptor identity

Every adapter exposes a closed `CycleStoreProviderDescriptor` before online
work. It binds:

- API and contract version;
- provider identity and schema version;
- compatible reader and writer intervals;
- operational limits;
- fixed online guarantees;
- closed capability levels;
- payload-protection responsibility;
- governance support;
- safe observability fields; and
- a SHA-256 identity over the canonical descriptor body with the
  `graph-engineering/cycle-store-provider-descriptor/v1alpha1\0` domain.

Unknown properties and enum values are errors. A provider may advertise a
smaller operational bound, but never a larger value than the contract ceiling:

| Limit | v1alpha1 ceiling |
| --- | ---: |
| records in one append | 64 |
| canonical bytes in one record | 1,048,576 |
| canonical bytes in one append | 8,388,608 |
| records or summaries in one page | 256 |
| canonical checkpoint bytes | 16,777,216 |
| requested lease or migration-lock TTL | 86,400,000 ms |
| sequence, epoch, fence, schema integer | 9,007,199,254,740,991 |
| identifier length | 128 ASCII-safe characters |

A durable adapter may declare stronger values from the closed vocabulary. It
cannot invent a guarantee. `durable` means the adapter has separate crash and
restart evidence; `distributedFencing: true` means a shared transactional
authority rejects stale writers across processes or hosts. Merely using a
database client does not establish either claim.

## Record carrier and tail

A record is closed portable JSON with:

- `recordId` unique within one tenant;
- nonnegative `sequence`;
- `previousRecordHash`, null only at sequence zero;
- `valueHash` over canonical value bytes;
- exact `valueBytes`;
- detached portable JSON `value`; and
- `recordHash` over the complete record body with the
  `graph-engineering/cycle-store-record/v1alpha1\0` domain.

The provider captures the request before its first await. Caller mutation after
invocation cannot alter a record, request hash, checkpoint, cursor, metric, or
committed byte. Reads return a new detached value; mutating a read cannot alter
provider state.

The tail of a missing or empty stream is exactly:

```json
{"exists":false,"sequence":-1,"recordHash":null}
```

A nonempty tail names the final committed sequence and record hash. Tail reads
used for append or ownership transfer are strongly consistent. An adapter
cannot serve them from an eventually consistent replica.

## Atomic append and compare-and-swap

An append carries tenant authorization context, a stable operation ID, stream
ID, expected tail, optional lease binding, and one bounded contiguous batch.
The normative order is:

1. capture a detached closed request;
2. validate versions, identifiers, hashes, portable values, and limits;
3. authorize before an existence-revealing lookup;
4. consult the tenant-scoped mutation ledger;
5. reject an incompatible live migration;
6. compare the exact tail sequence and hash;
7. validate the current write fence;
8. validate every record and the batch-local hash chain;
9. atomically commit all records, tenant-wide record IDs, and the idempotency
   result; and
10. return the new strong tail.

The expected hash is not redundant with expected sequence. It detects a
corrupt, restored, substituted, or otherwise divergent history that happens to
have the same length. No prefix can commit. A duplicate record ID, broken
chain, wrong expected hash, stale fence, or limit failure changes no state.

Controller semantic validation remains outside this operation. A provider can
accept a correctly shaped carrier whose application event would be illegal;
the controller must never submit that carrier. Conversely, a controller-valid
event is not safely durable until provider CAS succeeds.

## Mutation idempotency

Every mutation operation uses one tenant-scoped `operationId`. The provider
hashes the operation name and complete canonical request under
`graph-engineering/cycle-store-operation/v1alpha1\0`.

An exact retry returns the first canonical result even if:

- the stream tail advanced;
- the lease expired or was replaced;
- a migration began;
- a checkpoint was later deleted; or
- the first response was lost after commit.

This is why ledger lookup precedes current-state validation. Reusing an
operation ID with a changed byte or a different mutation operation returns
`GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT`. The adapter must persist the ledger in
the same transaction as the mutation; a separate best-effort table write does
not satisfy commit-then-throw recovery.

## Snapshot event pagination

The initial event-page request supplies `fromSequence`, a page size, and no
cursor. It fixes a snapshot tail. Continuations supply the returned cursor and
set `fromSequence` to null.

A cursor is opaque and bound to:

- contract and provider descriptor identity;
- provider schema version;
- tenant, principal, and authorization snapshot hashes;
- stream;
- page size;
- next sequence;
- snapshot tail sequence and hash; and
- bounded provider lifetime.

Every continuation returns the next nonoverlapping prefix. An append after the
first page is absent from that snapshot and appears in a new scan. A cursor is
single-use in the reference model. Unknown, malformed, expired, cross-tenant,
cross-stream, changed-page-size, and replayed tokens return
`GE_CYCLE_STORE_INVALID_CURSOR` without exposing record data.

An initial position beyond the snapshot tail returns one empty final page. A
missing stream returns `exists: false` and the empty tail rather than a
fabricated record or infinite cursor.

## Checkpoints are disposable caches

Checkpoint save, load, list, and delete are separate from event authority. A
checkpoint binds tenant, scope, ID, stream, exact event tail, created-at value,
canonical content hash and byte count, and detached body.

Save requires the current event tail and, after ownership begins, the current
write fence. One checkpoint ID is immutable until explicit deletion. Listing
uses descending bound sequence, descending created-at text, then ascending
checkpoint ID, and uses snapshot pagination. Delete requires the expected
content hash when the checkpoint exists and never deletes an event.

Load validates stored bytes again. Corruption returns
`GE_CYCLE_STORE_CORRUPTION`; controller recovery falls back to folding the
authoritative event stream. An adapter must not repair, reinterpret, or promote
a corrupt checkpoint during load.

## Lease clock, lifecycle, and fencing

The provider owns lease time. A caller requests a bounded TTL but never submits
trusted acquisition or expiry instants. A lease binds tenant, stream, lease ID,
holder ID, positive epoch, positive fencing token, provider acquisition time,
and provider expiry time.

Rules are closed:

- first acquisition starts epoch and fence at one;
- every later acquisition or takeover strictly increments both;
- renew preserves lease ID, holder, epoch, fence, and acquisition time while
  strictly extending expiry;
- release requires an exact active unexpired binding and retains counters;
- an active owner blocks acquire and early takeover;
- an expired active owner requires explicit takeover plus the prior fence;
- lease IDs cannot be reused;
- overflow is a quota failure with zero mutation; and
- once a stream has entered fenced ownership, append and checkpoint save
  require the exact active unexpired binding forever, including after release.

An exact mutation retry is answered from the ledger before clock or fence
checks. A stale holder, ID, fence, expired binding, missing binding, or released
binding returns `GE_CYCLE_STORE_STALE_FENCE`.

The memory oracle serializes these transitions with one process-local lock and
truthfully declares `distributedFencing: false`. A production adapter declaring
true must enforce the fence inside the same database transaction that performs
the write.

## Tenant authorization and payload protection

Every online and administrative request is tenant-scoped and carries a
principal hash plus authorization-policy snapshot hash. Authorization runs
before lookup that could reveal whether a stream, checkpoint, lease, or hold
exists. Identical stream, checkpoint, record, lease, and operation labels may
exist independently in different tenants.

The provider stores already-classified carriers. The reference descriptor says
payload protection is external and encryption at rest is absent for tests. It
does not satisfy protected-payload or key-management work. A durable adapter
must accept the protected carrier chosen by the security contract before
classified raw payloads are persisted.

Logs, traces, metrics labels, errors, database diagnostics, and backup metadata
must omit raw record values, checkpoint bodies, cursor contents, authorization
material, encryption secrets, and driver exceptions. Safe observations are
limited to operation/result class, duration bucket, canonical byte count,
record/page count, retry class, tenant hash, and provider ID.

## Error envelope

Every expected provider rejection is `CycleStoreProviderError` with `name`,
exact `code`, exact `operation`, deterministic `retryable`, a safe message, and
closed safe details. The v1alpha1 codes are:

- `GE_CYCLE_STORE_INVALID_ARGUMENT`;
- `GE_CYCLE_STORE_INVALID_CURSOR`;
- `GE_CYCLE_STORE_NOT_FOUND`;
- `GE_CYCLE_STORE_CONFLICT`;
- `GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT`;
- `GE_CYCLE_STORE_LEASE_CONFLICT`;
- `GE_CYCLE_STORE_STALE_FENCE`;
- `GE_CYCLE_STORE_UNAVAILABLE`;
- `GE_CYCLE_STORE_CORRUPTION`;
- `GE_CYCLE_STORE_QUOTA_EXCEEDED`;
- `GE_CYCLE_STORE_PERMISSION_DENIED`;
- `GE_CYCLE_STORE_UNSUPPORTED_VERSION`;
- `GE_CYCLE_STORE_LEGAL_HOLD`;
- `GE_CYCLE_STORE_MIGRATION_LOCKED`; and
- `GE_CYCLE_STORE_INTERNAL` only for last-resort boundary translation.

Generic driver exceptions never satisfy conformance. Adapter translation
should inspect a database error internally, select one stable provider code,
discard the raw exception text, and emit bounded safe details. Retryable does
not mean automatic retry is always safe; mutation callers still reuse the same
operation ID, while current-state conflicts usually require a fresh read and a
new operation.

## Governance and migration

The descriptor states closed retention, archive, legal-hold, backup/restore,
and compaction capability levels. Logical event sequences and hashes never
change under physical compaction. Archive must be lossless and hash-verifiable
before primary deletion. Legal hold blocks destructive administrative work.
Backup identity includes schema/provider identity, tenant scope, stream heads,
checkpoint summaries, fence state, mutation-ledger continuity, and one content
hash. Restore never silently overwrites a nonempty target or lowers a fence.

S01 proves declaration validation, legal-hold state, and the migration-lock
state machine. It does not implement destructive retention, archive, backup,
restore, or physical compaction operations.

Schema inspection is strongly consistent. One exclusive migration lock binds
source/target schema versions, owner, provider time, epoch, and fence. Exact
retry is idempotent. A second live lock is
`GE_CYCLE_STORE_MIGRATION_LOCKED`; takeover is legal only after expiry with the
prior fence and produces a higher fence. A live incompatible migration blocks
new online mutations, while a mutation committed before the lock may still be
retried from the idempotency ledger.

## Adapter capability matrix

| Claim | Memory oracle | SQLite candidate | PostgreSQL candidate |
| --- | --- | --- | --- |
| append atomicity | process lock | one local transaction | one database transaction |
| strong tail | process map | primary connection | primary/serializable read |
| crash durability | no | only after fsync/process-loss drill | only after WAL/failover drill |
| distributed fence | no | no multi-host claim | database-enforced conditional write |
| snapshot pagination | retained memory snapshot | read transaction or sealed cursor table | repeatable-read snapshot or sealed cursor table |
| mutation ledger | process map | same SQLite transaction | same PostgreSQL transaction |
| migration lock | process state machine | exclusive local transaction | advisory/row lock plus fence record |
| legal hold | reference state | requires destructive-operation enforcement | requires destructive-operation enforcement |
| backup/restore | declaration only | requires SQLite backup and restore drill | requires database backup and restore drill |
| protected payload | external | must integrate protected carrier | must integrate protected carrier |

SQLite may truthfully claim local durability only after locked transaction,
fsync, process-kill, reopen, corruption, and backup evidence. It must not claim
multi-host fencing. PostgreSQL may claim distributed fencing only when the
fence predicate and data mutation share a transaction and a stale process is
demonstrably rejected after takeover.

## Implementing an adapter

1. Return a truthful descriptor whose hash validates against the shared
   schema and semantic validator.
2. Translate public requests into one detached internal carrier before I/O.
3. authorize before existence-revealing queries;
4. store tenant scope in every primary, unique, and foreign key;
5. put idempotency lookup, CAS, record-ID uniqueness, fence check, record
   insert, and idempotency result in one transaction;
6. create snapshot cursors that bind the full scope and snapshot tail;
7. keep checkpoints in a table or namespace that can be dropped without
   harming replay;
8. use database/provider time for lease and migration expiry;
9. translate every expected database condition to the closed error taxonomy;
10. keep raw driver errors out of public errors and telemetry; and
11. run the complete shared campaign plus adapter-specific process-loss and
    database tests.

The portable campaign is invoked by:

```bash
corepack pnpm test:conformance
```

It runs 54 ordered cases independently in TypeScript and Python and deep
compares complete reports, including descriptor, record, operation, and case
identities; exact error code/operation/retryability; per-case final counters;
zero-mutation attack proofs; tails; checkpoint results; lease and migration
fences; and sentinel-leak scans. An adapter should reuse the same cases through
its native factory rather than copying expected results.

## Remaining gates

This contract unblocks adapter implementation but does not close it:

- S02: SQLite schema, transaction implementation, reopen/process-loss,
  corruption, backup, and restore evidence;
- S03: PostgreSQL migrations, concurrent clients, stale-owner fencing,
  failover, and backup/restore evidence;
- S04: protected carrier and key-reference integration;
- I01: controller adapter selection and end-to-end recovery drills; and
- release: performance envelopes, operational runbooks, independent review,
  package evidence, and stable compatibility policy.

Until those gates pass, the memory provider remains a deterministic local-test
surface and the project makes no production-store claim.
