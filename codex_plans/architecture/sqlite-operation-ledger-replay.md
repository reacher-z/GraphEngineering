# SQLite Operation-Ledger Replay Architecture

Status: acceptance-remediation design for D7-S02.

Owners: canonical protocol, TypeScript SQLite runtime, Python SQLite runtime,
interop/evidence, and independent hostile review.

This document defines the rigorous semantic closure between a committed
SQLite mutation, its idempotency-ledger row, and the durable state that the
mutation claims to have produced. It is intentionally narrower than the full
CycleStore protocol. It does not change authorization policy, make SQLite
distributed, or make checkpoints authoritative.

## 1. Problem statement

The version-1 operation ledger retains:

- tenant_id;
- operation_id;
- operation_name;
- a canonical request hash;
- canonical result bytes and their hash; and
- committed_at_ms.

Those fields prove exact retry identity and result-byte integrity. They do not
prove that a stored result belongs to the physical mutation beside it.
Several result shapes omit the entity identifiers needed for reconciliation:

- append identifies only the resulting tail and record count;
- delete-checkpoint returns only deleted;
- set-legal-hold returns the post-operation hold inventory;
- release-migration-lock returns null; and
- lease results do not by themselves encode every request precondition.

An attacker or storage fault can therefore replace result_blob and
result_hash with another canonical pair while leaving the records, checkpoint,
lease, hold, or migration state unchanged. A byte-round-trip audit accepts
that internally consistent forgery.

The repair must make the operation ledger replayable. A semantic audit must be
able to reconstruct every post-baseline mutation in exact commit order and
compare the reconstructed state with the physical database.

## 2. Architectural decision

Adopt a canonical schema version 2 with three additions:

1. Every post-baseline operation stores the exact canonical request bytes in
   request_blob.
2. Every post-baseline operation receives one globally contiguous
   commit_sequence allocated in the same SQLite transaction.
3. Every upgraded legacy database receives an immutable, canonical,
   scale-safe baseline projection that seeds deterministic replay without
   pretending that legacy request bytes can be reconstructed.

Keep result_blob as the existing public operation result encoding. Do not wrap
it in a storage-only envelope and do not change the shared result codec merely
to repair the SQLite schema.

The new schema is required because a schema-preserving envelope cannot
rigorously repair arbitrary legacy rows. For example, no deterministic
algorithm can recover the deleted checkpoint identity from a legacy
delete-checkpoint result containing only deleted, or a released migration lock
identity from a null result.

## 3. Non-negotiable invariants

### 3.1 New operation rows

Every version-2 row created after the baseline MUST satisfy all of these:

- ledger_format_version is 2;
- request_blob is a non-empty canonical UTF-8 JSON BLOB;
- decoding and re-encoding request_blob is byte-identical;
- the operation-specific domain hash of the decoded request equals
  request_hash;
- request.context.tenantId equals tenant_id;
- request.context.operationId equals operation_id;
- request fields are accepted by the same closed adapter codec used at the
  public boundary;
- result_blob decodes under operation_name and re-encodes byte-identically;
- the canonical result hash equals result_hash;
- commit_sequence is a safe integer greater than zero;
- committed_at_ms is a safe integer and is not earlier than the preceding
  committed sequence or the baseline capture time; and
- the mutation, sequence allocation, ledger insert, and clock-watermark update
  commit atomically.

### 3.2 Commit ordering

Across all tenants and all nine mutation types:

- the first post-baseline commit sequence is 1;
- every successful new mutation increments the sequence by exactly one;
- no committed gap, duplicate, zero, negative value, or overflow is valid;
- exact idempotent replay returns the original result and does not allocate a
  new sequence;
- a failed transaction does not consume a sequence;
- a killed pre-commit transaction does not consume a sequence;
- a killed post-commit/pre-acknowledgement transaction retains the sequence
  and exact ledger row;
- sequence order, never timestamp or operation ID sorting, defines replay
  order; and
- timestamps may tie but must not move backwards.

### 3.3 Legacy rows

Rows committed before the version-2 baseline use ledger_format_version 1 and
have null request_blob and null commit_sequence. They are accepted only when:

- their exact ordered inventory is committed into the baseline root;
- their count equals the baseline header legacy_operation_count;
- each result remains canonical and matches result_hash;
- no legacy row was inserted, removed, or changed after baseline capture; and
- no version-1 row exists outside the baseline inventory.

Legacy request_hash remains opaque evidence. Documentation and audit reports
must not claim that a pre-baseline request was reconstructed or replayed.

### 3.4 Baseline immutability

The baseline header and entries are append-on-migration, read-only afterward.
The runtime exposes no mutation API for them. Semantic audit rejects:

- a missing header;
- more than one active baseline;
- missing, duplicate, reordered, or extra entries;
- a changed entry key, value, kind, ordinal, or hash;
- a changed root, count, source identity, or capture time;
- a baseline containing post-baseline operation rows;
- a legacy operation not represented by the baseline; or
- any baseline/runtime state disagreement.

## 4. Canonical schema version 2

The canonical spec owns all names and field order. Exact final SQL remains a
reviewed artifact under spec/migrations/sqlite.

### 4.1 ge_cycle_operations version-2 shape

The version-2 table retains every version-1 field and adds:

- ledger_format_version INTEGER NOT NULL;
- request_blob BLOB;
- commit_sequence INTEGER.

The table-level shape enforces two disjoint forms:

- legacy form: format 1, request_blob null, commit_sequence null; or
- replayable form: format 2, request_blob non-null within the configured byte
  bound, commit_sequence between 1 and JavaScript MAX_SAFE_INTEGER.

The schema adds a unique partial index over commit_sequence for format-2 rows
and a commit-order index sufficient for bounded ordered replay.

The table keeps the primary key on tenant_id and operation_id. Operation-name
closure remains exactly the nine mutation names.

### 4.2 Sequence singleton

Add ge_cycle_operation_sequence with exactly one row:

- singleton = 1;
- baseline_id;
- last_commit_sequence;
- baseline_captured_at_ms;
- updated_at_ms.

The sequence row is a transactionally updated high-water mark, not a separate
side effect. last_commit_sequence equals the number and maximum of all
format-2 operation rows. It starts at zero.

### 4.3 Baseline header

Add ge_cycle_operation_baselines with one active row:

- baseline_id;
- baseline_format_version;
- source_application_id;
- source_user_version;
- source_schema_identity_sha256;
- source_migration_lineage_id;
- source_migration_lineage_sha256;
- source_descriptor_hash;
- captured_at_ms;
- legacy_operation_count;
- entry_count;
- first_entry_hash;
- final_entry_hash;
- canonical_projection_sha256;
- creation_runtime;
- creation_runtime_version; and
- policy_blob.

policy_blob is canonical and states the exact baseline entry domains,
normalization rules, payload omissions, replay start sequence, and supported
legacy limitations. Runtime/version fields are evidence only and do not enter
semantic equivalence unless the canonical spec explicitly says so.

### 4.4 Baseline entries

Add ge_cycle_operation_baseline_entries:

- baseline_id;
- ordinal;
- entry_kind;
- entry_key_blob;
- entry_state_blob;
- entry_hash;
- previous_entry_hash.

The primary key is baseline_id plus ordinal. A unique index covers
baseline_id, entry_kind, and the canonical key hash where needed.

Entries are sorted by the canonical tuple:

1. entry-kind rank fixed in spec;
2. canonical entry key bytes; and
3. canonical entry state bytes only where keys are equal by specification.

ordinal starts at zero and is contiguous. entry_hash is domain-separated over
baseline ID, ordinal, kind, key bytes, state bytes, and previous hash. The
first entry uses a fixed genesis hash. The header final_entry_hash equals the
last entry hash, or the fixed empty root when entry_count is zero.

The table is deliberately normalized rather than one unbounded baseline BLOB.
Migration and audit can stream one bounded row at a time and never materialize
an entire large database in memory.

## 5. Baseline projection

The projection stores enough logical state to seed replay. It does not
duplicate arbitrary user payload bytes that remain authoritatively stored and
separately canonical-audited.

### 5.1 Entry kinds

The fixed entry-kind inventory is:

1. schema-envelope;
2. migration-lineage;
3. stream-head;
4. record-identity;
5. checkpoint-current;
6. checkpoint-revision;
7. lease-current;
8. used-lease-identity;
9. legal-hold;
10. migration-lock-current;
11. used-migration-lock-identity; and
12. legacy-operation.

Cursors are excluded from operation replay because cursor creation and
consumption are read/pagination transactions, not operation-ledger mutations.
They remain covered by the independent semantic cursor audit.

### 5.2 Record identity entries

Each record identity entry includes:

- tenant ID;
- stream ID;
- sequence;
- record ID;
- previous record hash;
- value hash;
- value byte count;
- record hash; and
- committed_at_ms.

It omits value_blob and record_blob payload bytes. Migration first validates
those BLOBs canonically. Every later audit validates them again and compares
their identities with the baseline plus replayed appends.

This inventory is necessary to seed tenant-wide record-ID uniqueness and
stream hash-chain state. Storing only stream tails would not detect a future
append that reuses a baseline record ID.

### 5.3 Checkpoint entries

checkpoint-current records:

- tenant, scope, and checkpoint ID;
- complete canonical summary;
- value hash and byte count;
- checkpoint revision; and
- committed_at_ms.

checkpoint-revision records every retained revision row, including action and
all nullable/non-nullable fields. Payload values remain in the authoritative
checkpoint table and are validated independently.

### 5.4 Lease and migration entries

lease-current stores the complete active-or-released lease state and monotonic
counters per tenant/stream. used-lease-identity stores every retired or active
ID with its epoch, fence, and first-use time.

migration-lock-current stores the singleton active-or-released state and
counters. used-migration-lock-identity stores every lock ID and fence.

These entries prevent a migrated database from silently losing non-reuse
history.

### 5.5 Legal-hold entries

One legal-hold entry exists per tenant, stream, and hold ID with placed time.
The replay model derives the exact sorted post-operation set after every
place/release.

### 5.6 Legacy operation entries

Each legacy-operation entry includes:

- tenant ID;
- operation ID;
- operation name;
- request hash;
- result hash;
- committed_at_ms; and
- SHA-256 of the exact result BLOB.

The migration validates and retains the original result BLOB. The baseline
does not invent request bytes.

## 6. Migration strategy

### 6.1 Immutable artifacts

Do not rewrite schema-v1.sql or 0001-alpha-v0-to-v1.sql. Add:

- schema-v2.sql;
- 0002-v1-to-v2-operation-replay.sql;
- schema-v2.identity.json;
- updated manifest.json with both migration edges;
- a frozen pre-replay-v1 fixture; and
- expected v0-to-v2 and v1-to-v2 reports.

The existing v0 fixture remains byte-identical and continues to prove the
existing v0-to-v1 edge before the new v1-to-v2 edge runs.

### 6.2 Transactional upgrade

Migration runs under one exclusive writer transaction:

1. establish hardened connection settings and read them back;
2. validate source application ID, user version, schema identity, catalog, and
   migration hashes;
3. run full physical, foreign-key, and semantic audit of the source;
4. execute only manifest-bound version-2 SQL;
5. enumerate source logical state in canonical entry order;
6. canonicalize and hash each entry with bounded memory;
7. insert baseline entries and header;
8. convert existing operation rows to explicit legacy form;
9. initialize sequence singleton at zero;
10. validate exact entry counts, chain root, legacy inventory, new indexes,
    schema identity, and catalog;
11. set application/user version metadata only after all postconditions pass;
12. commit once; and
13. rerun complete version-2 semantic audit after open.

Any failure rolls back schema, baseline, sequence state, application metadata,
and all converted rows.

### 6.3 v0 handling

Opening v0 executes the trusted v0-to-v1 and v1-to-v2 steps under one managed
upgrade session. A crash may leave either the untouched v0 file or a complete
supported version, never a partially published baseline.

If implementation constraints require an intermediate commit, recovery must
prove that the complete v1 state is independently supported, re-openable, and
will deterministically resume v1-to-v2. The preferred implementation remains
one exclusive transaction.

### 6.4 Why request reconstruction is forbidden

Migration must not guess request identifiers from results or current rows.
Inference may appear to work for the existing append/release fixture but fails
for general:

- delete-checkpoint;
- repeated legal-hold operations ending in the same set;
- lease renew/release histories;
- release-migration-lock;
- multiple streams with identical local fence numbers; and
- operations whose current state has since been superseded.

The baseline is the explicit trust transition from validated legacy state to
fully replayable future state.

## 7. New mutation transaction

For each new mutation:

1. capture and detach the complete request before authorization await;
2. authorize the captured context;
3. encode request_blob once with the shared canonical codec;
4. compute its operation-specific request hash;
5. begin the bounded BEGIN IMMEDIATE retry loop;
6. look up tenant_id plus operation_id before allocating a sequence;
7. on exact replay, validate operation/request/result and return without
   touching the sequence singleton;
8. reserve and read all decision state;
9. validate operation preconditions;
10. apply the physical mutation;
11. deterministically derive and encode the result;
12. increment sequence singleton with exact CAS and overflow check;
13. insert the format-2 ledger row with request/result bytes and the new
    sequence;
14. execute retained staged/before-commit fault boundaries;
15. commit;
16. execute commit-returned/before-acknowledgement boundaries; and
17. decode a detached result for the caller.

No await occurs from BEGIN through COMMIT. Python performs the complete block
on its one owner worker. TypeScript documents the synchronous event-loop
blocking bound.

## 8. Deterministic replay model

The replay engine is deterministic plumbing. It must not invoke models,
authorization hooks, filesystem side effects, clocks, randomness, or network
calls.

### 8.1 Inputs

- validated baseline entries;
- ordered format-2 operation rows;
- fixed descriptor limits and schema identities; and
- fixed canonical request/result codecs.

### 8.2 Common validation per row

For each sequence:

- assert expected next sequence;
- assert canonical request byte round-trip;
- decode request under operation name;
- recompute request hash;
- bind request context to row primary key;
- assert canonical result byte round-trip;
- recompute result hash;
- validate committed time and clock monotonicity;
- apply the operation transition;
- independently derive expected result; and
- compare expected and stored results byte-for-byte.

### 8.3 append transition

Replay validates:

- expected tail equals reconstructed stream tail;
- lease binding and active expiry/fence at committed_at_ms;
- batch bounds and non-empty batch;
- exact sequence and previous-hash continuity;
- record/value hashes and byte counts;
- batch-local and tenant-wide record-ID uniqueness;
- no safe-integer overflow;
- derived final tail; and
- result tail plus appendedRecords.

Every appended record becomes part of reconstructed immutable identity state.

### 8.4 save-checkpoint transition

Replay validates:

- bound stream record exists at the exact sequence/hash;
- live lease/fence where required;
- checkpoint canonical identity and value bytes;
- immutable-ID/equal-retry rules;
- next scope revision without overflow;
- current checkpoint and revision state; and
- exact returned summary.

### 8.5 delete-checkpoint transition

Replay validates:

- named checkpoint existence or absence;
- expectedValueHash behavior;
- legal-hold blocking on the checkpoint stream;
- revision allocation only for a real deletion;
- physical current-state removal; and
- exact deleted boolean.

### 8.6 acquire, renew, and release lease transitions

Replay validates:

- stream existence;
- expected fencing token;
- acquire versus expired takeover mode;
- global non-reuse for the stream;
- safe counter and timestamp arithmetic;
- binding identity and expiry at committed time;
- strictly extended renewal;
- released active fields and retained counters; and
- exact lease or inspection result.

### 8.7 legal-hold transition

Replay validates stream existence, applies idempotent place/release to the
reconstructed set, preserves placed time for an existing hold, and compares
the exact sorted governance inspection.

### 8.8 migration-lock transitions

Replay validates source/target versions, expected fence, acquire/takeover
timing, lock-ID non-reuse, safe counters/timestamps, exact release binding, and
the exact lock or null result.

## 9. Final-state reconciliation

After replay, semantic audit compares reconstructed state with independent SQL
reads of:

- every stream head;
- every record identity and canonical value/record BLOB;
- every current checkpoint, checkpoint_revision, and revision row;
- every current lease row and used lease identity;
- every legal hold;
- the migration-lock singleton and every used lock identity;
- every operation primary key, format, hash, canonical BLOB, timestamp, and
  sequence;
- sequence singleton counters; and
- baseline header/entries.

Comparison is exact and bidirectional. A physical row missing from replay and
a replayed row missing physically are both corruption.

Cursor semantic audit remains separate but must additionally bind every event
snapshot tail sequence/hash to an immutable record row. Current checkpoints
must bind checkpoint_revision to the exact retained revision row.

## 10. TypeScript/Python parity

Both runtimes consume the same spec assets and produce byte-identical:

- request_blob;
- request_hash;
- baseline key/state BLOBs;
- baseline entry hashes and chain root;
- commit sequence allocation semantics;
- replay decisions;
- expected result BLOBs;
- semantic audit digest; and
- safe serialized failures.

Do not implement two independently invented baseline formats. A shared
conformance fixture defines canonical bytes for each operation and every
baseline entry kind.

Cross-language tests alternate writers on one file, not copies. At every
handoff the other runtime audits before writing.

## 11. Error and security behavior

- Invalid stored request bytes map to GE_CYCLE_STORE_CORRUPTION.
- Incoming reuse with a changed request remains
  GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT.
- Sequence exhaustion maps to GE_CYCLE_STORE_QUOTA_EXCEEDED before mutation.
- Lock exhaustion remains bounded GE_CYCLE_STORE_UNAVAILABLE.
- Unknown schema or ledger format maps to GE_CYCLE_STORE_UNSUPPORTED_VERSION.
- No raw request, result, payload, SQLite message, SQL text, path, or sentinel
  appears in public errors or logs.
- Semantic audit reports only bounded labels, counters, and hashes.
- request_blob contains only the already canonical provider request. It must
  never contain bearer tokens, raw credentials, or unvalidated objects.
- Telemetry and request/result capture remain off by default.

## 12. Backup, restore, and artifact closure

Online backup must include:

- version-2 schema identity;
- baseline tables and root;
- operation sequence singleton;
- request BLOBs;
- operation rows and indexes; and
- updated semantic identity in the manifest.

Restore verifies the external backup manifest before open, migrates only when
explicitly allowed, performs full replay audit, and publishes only to a new
path.

npm, wheel, and sdist gates install artifacts in isolation, create or migrate
a database, append a format-2 mutation, close/reopen, replay exact retry, run
semantic audit, and verify all migration assets byte-for-byte.

## 13. Required evidence

Retained evidence includes:

- old and new schema/migration/identity/manifest hashes;
- v0-to-v2 and v1-to-v2 fixture hashes and reports;
- canonical request vectors for all nine operations;
- canonical baseline vectors for all entry kinds;
- TypeScript/Python differential replay reports;
- exact sequence and baseline counters;
- hostile tamper matrix results;
- nine-stage process barrier kill reports;
- backup/restore cross-runtime reports;
- artifact inventories and installed smokes;
- commit/tree/parent hashes for the immutable candidate; and
- explicit nonclaims.

## 14. Explicit nonclaims

This design does not claim:

- recovery of canonical request bytes for pre-baseline operations;
- malicious-tamper detection when an attacker coherently rewrites the entire
  database and every external trust anchor;
- distributed consensus or distributed fencing;
- protection from a compromised process holding database write authority;
- encrypted payloads at rest;
- authoritative checkpoints;
- scheduler integration;
- PostgreSQL parity;
- production throughput;
- release readiness; or
- GitHub popularity.

It does claim, only after all gates pass, deterministic detection of any
database state that is inconsistent with its retained baseline and ordered
post-baseline operation history.
