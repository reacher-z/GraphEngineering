# SQLite baseline reconciliation v1

Status: rule registry frozen; cursor-chain roots and native implementation incomplete.

This contract defines how a SQLite schema-v1 cycle store is converted into the
ordered operation-baseline input for schema v2. It supplements
[`sqlite-operation-ledger-v2.md`](sqlite-operation-ledger-v2.md). The closed
machine-readable registry is
[`conformance/sqlite-baseline-reconciliation.case.json`](conformance/sqlite-baseline-reconciliation.case.json).

No rule in this document authorizes schema-v2 publication. The active native
implementation claim remains false until staging, all relation rules, cursor
sealing/rebinding, atomic 0002 publication, crash recovery, replay,
cross-language handoff, and the frozen 96-case campaign pass.

## Owner and TEMP preconditions

The migration owner configures TEMP storage before opening a transaction:

- `PRAGMA temp_store = FILE`;
- `PRAGMA temp.cache_size` is a negative KiB value, default `-8192`, bounded
  from `-65536` through `-1024`;
- `PRAGMA cache_spill = ON`; and
- `temp_store_directory` is forbidden for every schema qualifier and spelling.

Every setting is read back. Configuration inside a transaction fails. Capture
then requires an owner-observed `BEGIN EXCLUSIVE`; an active deferred,
immediate, savepoint-only, unknown, or replaced transaction is insufficient.
Rollback/commit/rebegin, multi-statement transaction swaps, and raw prepared
transaction control invalidate the proof.

The existing public source iterator remains read-only and freezes
`total_changes`. A separate module-private reconciler may write TEMP rows. It
tracks an allowed change counter and requires every stage and relation insert
to change exactly one row. An unexplained main or TEMP write, ignored insert,
replacement, duplicate, or incorrect delta poisons the reconciler.

## Common stage

The common TEMP stage is STRICT and WITHOUT ROWID. Its primary key is
`(kind_rank,key_blob)` and it also uniquely binds `(entry_kind,key_blob)`.
`kind_rank` is `0..11`; kind order equals the frozen baseline kind order.
`key_blob` is exact canonical UTF-8 between 2 and 4,096 bytes. `state_blob` is
exact canonical UTF-8 between 2 and 2,097,152 bytes.

Every v1 row is decoded, validated, canonically encoded, inserted into the
common stage, projected into exactly one normalized relation, and released
before the next row advances. Record, current checkpoint, checkpoint revision,
and legacy result carriers advance one row at a time. Payload BLOBs are never
copied into TEMP relations.

After all source statements are finalized, a union relation-key view proves
stage-to-relation and relation-to-stage coverage. Counts are compared per kind
and in total. Stage output is one-shot and ordered by `(kind_rank,key_blob)`.

## Normalized relations

All relation tables are STRICT and WITHOUT ROWID, retain a unique `key_blob`,
and store only invariant scalars:

1. schema singleton;
2. migration lineage keyed by version;
3. streams keyed by tenant and stream;
4. records keyed by tenant and record ID, unique by tenant/hash and by
   tenant/stream/sequence;
5. current checkpoints keyed by tenant/scope/checkpoint ID;
6. checkpoint revisions keyed by tenant/scope/revision and indexed by
   checkpoint ID with descending revision;
7. leases keyed by tenant and stream;
8. used leases keyed by tenant/stream/lease ID and unique by epoch;
9. holds keyed by tenant/stream/hold ID;
10. the migration-lock singleton;
11. used migration locks keyed by lock ID and unique by epoch; and
12. legacy operations keyed by tenant and operation ID.

Checkpoint put relations extract `streamId` from the already validated
canonical summary so exact record binding is queryable. Legacy relations store
the independent raw-result SHA-256 and only operation-discriminated decoded
binding scalars. They never retain `result_blob`, an invented request, a
snapshot, or a variable-length hold list.

## Required invariant groups

The ordered rule registry is normative. Implementations must report the exact
registry `ruleId`; messages are not protocol identity.

- Source rules bind schema/migration singletons, lineage, descriptor, capture
  clock, transaction ownership, and expected counts.
- Stream/record rules reject orphans, persisted empty streams, position gaps,
  predecessor drift, tail drift, tenant-wide hash duplication, and any drift
  between a normalized record relation and its canonical common-stage key and
  state. `BLR_STREAM_EMPTY` means that any persisted stream whose
  `tail_sequence` is `-1` is a violation, even when its null tail hash is a
  well-formed empty sentinel. `BLR_RECORD_BINDING` is the distinct scalar,
  hash, value-length, clock, and canonical common-state binding rule; it must
  not be reported as `BLR_RECORD_HASH_DUPLICATE`.
- Checkpoint rules require contiguous scope revisions, exact put-record
  identity, latest put/current equality, latest delete/current absence, and
  complete scalar/summary agreement.
- Lease/lock rules require exact ownership, complete `1..highWater` histories,
  equal epoch/fence, active-to-final-used identity, acquisition time, expiry,
  and forward-only migration targets. Holds require an exact stream.
- Legacy rules prove physical inventory plus recoverable append,
  checkpoint-save, lease acquire/renew, and migration-lock acquire bindings.
  Missing v1 request bytes are never reconstructed.
- Cursor rules validate authorization, scope, canonical BLOBs, positions,
  expiry/consumption, event tails, checkpoint revisions, catalog identity,
  seal count, immutable seal, and exact rebind count.
- Publication rules later prove bidirectional stage/permanent-entry coverage,
  header identity, and sequence-zero identity.

## Safe diagnostic envelope

A reconciliation violation exposes exactly:

```json
{"ruleId":"BLR_RECORD_GAP","violationCount":1,"diagnosticsTruncated":false}
```

The diagnostic limit defaults to 16 and is bounded at 64. No tenant, stream,
operation, record, token, request, result, BLOB, payload, message, or dynamic
identity value is a diagnostic field. A caller receives no envelope when
there is no violation.

## Cursor seal

Cursor rows are scanned in token-hash then tenant byte order. Immutable seal
rows cover authorization hashes, kind, optional stream/scope, page and next
position, optional tail, creation/expiry/consumption, and the byte length plus
SHA-256 of request-scope and snapshot BLOBs. Provider descriptor hash and
schema identity are validated but excluded from the immutable row because
they are the only 0002 rebind fields.

The frozen domains are:

```text
graph-engineering/sqlite-cursor-seal-row/v1\0
graph-engineering/sqlite-cursor-seal/v1\0
```

No empty or golden cursor root is claimed in this protocol slice. Such a root
must be appended only after independent TypeScript/Python derivation agrees.

## Scale, cleanup, and non-claims

Capture failure finalizes the current source cursor and best-effort drops TEMP
objects; only the caller rolls back. Disposal is deterministic and idempotent.
A poisoned object exposes only disposal. An abandoned output iterator is
closed before any DDL or publication.

Fast characterization uses 128 and 1,024 rows. Scheduled evidence uses exact
10K and 100K generators without `.all()`, `fetchall()`, or a full-size native
collection. It records counts, roots, fetch sizes, query plans, TEMP pages,
database/WAL/SHM sizes, latency samples, and peak RSS. Until reviewed gates
exist, evidence retains `releaseGate:false`,
`productionThroughputClaim:false`, and `implementationClaim:false`.
