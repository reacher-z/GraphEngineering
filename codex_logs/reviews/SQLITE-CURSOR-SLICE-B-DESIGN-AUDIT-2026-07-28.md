# SQLite cursor Slice B acceptance and implementation contract

Date: 2026-07-28

Scope: private SQLite baseline-reconciliation cursor campaign, TypeScript/Python parity
Inputs reviewed: master-plan sections 31.34.44, 31.34.45, 31.34.48-49,
31.35.2-4 and 31.35.7; the live A1, A2a and A2b implementations and tests;
the live source, stage, legacy-campaign, SQLite connection and semantic-integrity
implementations; the v1 schema, v2 preview manifest, ledger-v2 contract and frozen
54-rule registry.

This is an implementation design, not completion evidence. It intentionally does
not modify the master plan, daily log, task registry, runtime or tests.

## 1. Acceptance decision

Slice B must be implemented as the database-integrated **pre-rebind** cursor
campaign. Its successful terminal value is an opaque A2b pre-rebind receipt and
the private state `pre-rebind-complete`. It runs rules 1 through 10 only. It does
not execute migration 0002, update either mutable cursor identity, run rules 11
or 12, reach `cursor/clock-complete`, commit the owner transaction, or change the
registry claim.

Section 31.35.4 is authoritative that Slice B receives and verifies the A2b
receipt before creating its TEMP seal object. A1 is database-independent and
can finish before Slice B from any already canonically ordered iterable. The
accepted A2b tests demonstrate that property with generated cursor rows; they
do not prove a production arbitrary-size `main.ge_cycle_cursors` scan or its
query plan. Slice B must therefore consume the existing receipt, then
independently reproduce its count/root from the real database through the
owned TEMP reorder stage. The exact order is:

1. fence the A2b receipt and bind its captured source to the exact live
   stage/connection/transaction;
2. only after that succeeds, create the private TEMP cursor stage;
3. scan and validate `main.ge_cycle_cursors` in physical PK order;
4. run rules 1-10 and stream the TEMP stage in canonical seal order;
5. require the reproduced A1 count/root and every retained A2b contribution to
   equal the input receipt's exact provenance; and
6. store that same receipt and transition to `pre-rebind-complete`.

The same A2b receipt is the sole explicit input to Slice B and later to the
publication/rebind owner. Slice B does not issue a replacement receipt.

### Re-review note: the former receipt/TEMP circularity finding is withdrawn

The first audit draft incorrectly stated that A1 can only be produced after
the Slice B TEMP stage. The live evidence does not support that claim:

- `sealSQLiteCursorRows` in
  `packages/sqlite/src/operation-baseline-cursor-invariants.ts:585` accepts any
  already canonically ordered `Iterable<SQLiteCursorSealRow>` and has no
  database or TEMP dependency. Its Python counterpart
  `seal_sqlite_v1_cursor_rows` at
  `python/src/graph_engineering/sqlite_operation_baseline_cursor_invariants.py:489`
  has the same property.
- The TypeScript A2b real-source test captures a real fresh-v1 baseline source
  at lines 202-208 of
  `packages/sqlite/test/operation-baseline-cursor-ownership.test.ts`, but lines
  212-217 supply generated `sharedCursorRow` / `sharedFleetRows` iterables to
  A1; they do not query `main.ge_cycle_cursors`.
- Python `_candidate` captures the real source at lines 167-179 of
  `python/tests/test_sqlite_operation_baseline_cursor_ownership.py`, while
  lines 181-186 pass its `cursor_rows` argument directly to A1. The vector test
  constructs those rows at lines 307-316.

Those tests prove that a valid A2b receipt can pre-exist Slice B; they do not
prove an arbitrary-size production main-table traversal. The latter is exactly
why Slice B must re-scan through the owned TEMP reorder stage and compare its
fresh A1 result with the input receipt. This distinction preserves the plan's
receipt-before-TEMP requirement and removes the former H2 finding.

## 2. Severity findings and blockers

### HIGH H1: A2b alone does not prove the live owned SQLite connection

The existing A2b fence is correct for its declared database-free primitive, but
is insufficient as the only database campaign entry check:

- TypeScript accepts a structurally exact frozen synthetic source summary; its
  own A2b tests deliberately use one. Four capability commitments are derived
  from caller-supplied 32-byte references and are not attached to a
  `SQLiteConnection`, `SQLiteBaselineTempStage`, or transaction epoch.
- Python retains `_connection`, `_captured_transaction_epoch` and
  `_source_total_changes` on the exact summary object, but A2b does not prove
  that connection is the campaign connection. Its capability commitments have
  the same intentionally database-independent semantics.
- `assert*PreRebindReceiptProvenance` proves module minting and the retained
  object graph; it cannot turn a database-free commitment into a live owner
  proof.

This is not a retroactive A2b defect: A2b explicitly promises no database
integration. It is a Slice B blocker. Add a package-private captured-source
provenance fence and revalidate it synchronously at campaign begin before the
first `CREATE TEMP`.

TypeScript can attach provenance without changing the public summary shape:
the frozen object returned by `captureSQLiteV1BaselineSourceSummary` is a valid
`WeakMap` key. Register `{connection, transactionEpoch, clockEvidence,
sourceEnvelopeIdentity}` immediately before return. The private assertion must
require exact summary identity, exact connection identity, exact clock object,
active EXCLUSIVE mode, and unchanged captured transaction epoch.

Python must require `type(summary) is SQLiteV1BaselineSourceSummary`, exact
`summary._connection is connection`, exact clock object, active EXCLUSIVE mode,
and current epoch equal to `_captured_transaction_epoch`. It must not require
current `total_changes == _source_total_changes`, because the already accepted
common/relation TEMP handoff has intentionally advanced total changes. Instead,
the stage's private allowed-change fence must prove the current count. These two
checks must be adjacent, synchronous, and repeated after every DDL/cursor
boundary to close a mutable-connection race.

### HIGH H2: A1's strict decoder cannot own rule diagnostics by itself

`decodeSQLiteCursorSealRow` / `decode_sqlite_v1_cursor_seal_row` rejects
noncanonical blobs, bad scope/null groups and invalid clock intervals before a
rule can emit `BLR_CURSOR_BLOB_CANONICAL`, `BLR_CURSOR_SCOPE`,
`BLR_CURSOR_SHAPE`, or `BLR_CURSOR_EXPIRY_CONSUMPTION`. Slice B needs a private
inspection result that separates:

- fatal owner/catalog/statement failures;
- one-row rule booleans for rules 1-6, 8-10; and
- an optional A1-seal-eligible row.

A diagnosed row may be staged with only scalar/digest evidence, but it may not
be appended to A1. The campaign returns a structured `diagnosed` outcome and
does not return its input receipt if any diagnostic exists. It may return the
same receipt as verified only when every row is seal eligible, the reproduced
count/root equals its provenance and the ten-rule vector is all zero. No
missing receipt is represented by `null`.

### MEDIUM M1: checkpoint tie-break wording conflicts with the real provider

The exact frozen order is `bound_sequence DESC, created_at DESC,
checkpoint_id ASC`, as proved by schema-v1's named index and both providers.
The plan's shorthand “descending sequence/creation/ID” must not be implemented
as descending checkpoint ID. Rule 10 uses ascending UTF-8/BINARY checkpoint ID
for the final tie-break.

### MEDIUM M2: true asynchronous cancellation has no current owner surface

Both campaigns are synchronous. Node's `DatabaseSync` loop blocks normal
event-loop delivery, and the Python owner exposes no progress handler or
interrupt capability. The first Slice B slice can implement deterministic
cooperative cancellation checks at statement creation, each fetch, each insert,
between rules and before completion. A later owner-level checkpoint must add a
real cross-thread/progress-handler interruption mechanism before claiming
in-flight SQLite cancellation.

### MEDIUM M3: the hostile outcome shape is not frozen

The plan asks one hostile fixture to have both a ten-number vector and a
pre-rebind seal. A row that genuinely violates shape or A1 canonical-decoding
preconditions has no valid A1 row and therefore cannot contribute to a claimed
A1 root. Freeze a discriminated outcome: clean fixtures have the receipt/root;
hostile fixtures have the exact diagnostic vector and `status: diagnosed`, with
no receipt-shaped field. Do not invent a second “best effort” seal.

### LOW L1: tenant capability names the database tenant namespace

The reconciliation scans all tenants. The existing A2b `tenantOwnership`
capability must be documented internally as ownership of the connection's
complete tenant namespace, not one tenant ID. It must never contain or expose a
tenant string.

## 3. Frozen execution segments

### B0: ownership bridge (first implementable database slice)

Preconditions:

- FILE-backed TEMP configuration was read back before the transaction;
- the exact caller-owned connection is open in owner-observed `BEGIN
  EXCLUSIVE`;
- common/relation handoff and stream/record, checkpoint, lease/lock/hold and
  legacy campaigns completed on the exact projection object;
- the exact A2b receipt is presented as the sole explicit campaign input and
  its non-consuming provenance fence succeeds;
- source summary is module-captured, not merely structurally equal;
- source capture epoch equals the live transaction epoch;
- stage allowed total changes equals live `total_changes()`; and
- no cursor campaign has begun on the stage.

B0 adds no cursor query yet. It proves that the stage can open one private
cursor campaign session only from the exact receipt/source/connection/
projection graph. It first calls the existing A2b provenance fence, then the
new captured-source provenance fence, then the stage owner fence. Wrong
receipt, connection, source clone, projection clone, pre-legacy begin, second
begin, rollback/rebegin and stale epoch poison or reject before any cursor TEMP
object exists.

The package-private constructor/factory surface is exact in intent:

```ts
new SQLiteCursorPreRebindCampaign(connection, stage, receipt, options?)
```

`receipt` is the only explicit source/projection/session context. The campaign
derives the exact source summary, clock evidence, projection and ownership
handles only through `assertSQLiteCursorPreRebindReceiptProvenance(receipt)`;
it accepts no parallel caller-supplied copies of those values. Python mirrors
this positional ownership with exact runtime types.

### B1: TEMP catalog and pristine capture/seal

After B0, create exactly one new reserved object:

```sql
CREATE TEMP TABLE ge_blr_cursor_seal (
  token_hash TEXT NOT NULL COLLATE BINARY,
  tenant_id TEXT NOT NULL COLLATE BINARY,
  kind TEXT NOT NULL,
  principal_hash TEXT NOT NULL,
  authorization_hash TEXT NOT NULL,
  stream_id TEXT,
  checkpoint_scope TEXT,
  request_scope_byte_length INTEGER NOT NULL,
  request_scope_blob_sha256 TEXT NOT NULL,
  page_size INTEGER NOT NULL,
  next_position INTEGER NOT NULL,
  snapshot_tail_sequence INTEGER,
  snapshot_tail_record_hash TEXT,
  snapshot_byte_length INTEGER NOT NULL,
  snapshot_blob_sha256 TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  consumed_at_ms INTEGER,
  descriptor_hash TEXT NOT NULL,
  schema_identity_sha256 TEXT NOT NULL,
  authorization_ok INTEGER NOT NULL CHECK (authorization_ok IN (0, 1)),
  scope_ok INTEGER NOT NULL CHECK (scope_ok IN (0, 1)),
  blobs_canonical_ok INTEGER NOT NULL CHECK (blobs_canonical_ok IN (0, 1)),
  position_ok INTEGER NOT NULL CHECK (position_ok IN (0, 1)),
  clock_ok INTEGER NOT NULL CHECK (clock_ok IN (0, 1)),
  catalog_ok INTEGER NOT NULL CHECK (catalog_ok IN (0, 1)),
  shape_ok INTEGER NOT NULL CHECK (shape_ok IN (0, 1)),
  event_binding_ok INTEGER NOT NULL CHECK (event_binding_ok IN (0, 1)),
  checkpoint_binding_ok INTEGER NOT NULL CHECK (checkpoint_binding_ok IN (0, 1)),
  seal_eligible INTEGER NOT NULL CHECK (seal_eligible IN (0, 1)),
  PRIMARY KEY (token_hash, tenant_id)
) STRICT, WITHOUT ROWID
```

The exact DDL hash must be frozen cross-runtime before acceptance. Do not put
either raw BLOB, decoded JSON, summary array, token plaintext or diagnostic text
in this table. If implementation experience requires a status bit to be split,
change both runtimes and the DDL fixture together before accepting a root.

Catalog fencing becomes phase-aware: the old exact baseline catalog is still
required through legacy completion; the cursor phase requires that exact set
plus this one exact table. Same-name replacement, rootpage/SQL drift, extra
`ge_blr_*` object or loss of STRICT/WITHOUT ROWID poisons the stage.

Run the real source query already frozen by A2b:

```sql
SELECT tenant_id, token_hash, kind,
       principal_hash, authorization_hash, stream_id, checkpoint_scope,
       request_scope_blob, page_size, next_position, snapshot_tail_sequence,
       snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256,
       snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms
  FROM main.ge_cycle_cursors
 ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY
```

The query hash remains
`dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4`.
One source cursor, one current physical row and at most one decoded checkpoint
snapshot are live. Compute BLOB byte lengths/digests and rule booleans, execute
one exact TEMP insert, prove statement changes 1 and global delta +1, release
the raw BLOBs/decoded value, then advance. Main count, source-walk count and
TEMP count must agree.

For the clean-path first checkpoint only, stream:

```sql
SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash,
       stream_id, checkpoint_scope, request_scope_byte_length,
       request_scope_blob_sha256, page_size, next_position,
       snapshot_tail_sequence, snapshot_tail_record_hash,
       snapshot_byte_length, snapshot_blob_sha256, created_at_ms,
       expires_at_ms, consumed_at_ms, descriptor_hash,
       schema_identity_sha256
  FROM temp.ge_blr_cursor_seal
 WHERE seal_eligible = 1
 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY
```

Feed reconstructed `SQLiteCursorSealRow` values to the existing A1 accumulator,
never a second seal implementation. The accepted empty/event/pair/1,024 roots
remain unchanged. The result is a fresh A1 proof used only to compare with the
input A2b receipt's retained `sealReceipt`; it does not mint a new A2b receipt.

### B2: rules 1-10 and clean completion

Rules execute in frozen registry order. Every marker query is fixed SQL with
one `LIMIT ?` parameter set to `diagnosticLimit + 1`. Each row contributes at
most one marker per rule. The safe report contains only rule ID, capped count
and truncation flag.

| # | rule | exact unit and test |
| --- | --- | --- |
| 1 | `BLR_CURSOR_AUTHORIZATION` | one cursor row whose tenant/token identifiers or principal/authorization lowercase-64 hashes are invalid; never reconstruct token plaintext |
| 2 | `BLR_CURSOR_SCOPE` | one row whose event/checkpoint null group or decoded `{contractVersion, streamId/checkpointScope, pageSize}` tuple differs from the physical tuple |
| 3 | `BLR_CURSOR_BLOB_CANONICAL` | one row where either BLOB is out of bounds, invalid UTF-8/JSON, has duplicate keys/BOM/nonportable constants, or does not byte-equal canonical re-encoding |
| 4 | `BLR_CURSOR_POSITION` | one row with unsafe/out-of-range page/position, event position beyond a nonempty frozen tail, nonzero position for an empty event snapshot, or checkpoint position beyond decoded array length |
| 5 | `BLR_CURSOR_EXPIRY_CONSUMPTION` | one row with unsafe clocks, `expires <= created`, `consumed < created`, cursor creation/consumption above frozen provider high-water, or capture below the rechecked high-water; expiry is not a provider observation |
| 6 | `BLR_CURSOR_CATALOG_BINDING` | one row whose descriptor/schema differs from the frozen source identities; catalog object drift itself is terminal, not this row diagnostic |
| 7 | `BLR_CURSOR_SEAL_COUNT` | one pre-rebind inventory delta: captured main count, source rows, TEMP rows, seal-eligible rows and A1 count are not all equal; never one marker per missing row |
| 8 | `BLR_CURSOR_SHAPE` | one physical row with wrong arity/storage class/null group/identifier-hash lexical shape not assigned to another semantic rule; replacement catalog is terminal before this rule |
| 9 | `BLR_CURSOR_EVENT_BINDING` | one event row whose canonical snapshot does not equal its tail tuple or whose nonempty tail lacks exact retained `(tenant,stream,sequence,hash)` history; later stream-head/record append is allowed |
| 10 | `BLR_CURSOR_CHECKPOINT_BINDING` | one checkpoint row with a summary lacking an exact same-tenant/scope/id historical `put` revision or not ordered sequence DESC, creation DESC, ID ASC; later current mutation/delete is allowed |

Recommended fixed marker form for row rules is:

```sql
SELECT 1
  FROM temp.ge_blr_cursor_seal INDEXED BY sqlite_autoindex_ge_blr_cursor_seal_1
 WHERE <rule_column> = 0
 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY
 LIMIT ?
```

Freeze actual EQP output on the supported SQLite floor before retaining the
`INDEXED BY` spelling; WITHOUT ROWID primary-key naming differs from ordinary
rowid tables. The acceptance property, not a guessed index name, is no
`AUTOMATIC`, `MATERIALIZE`, `USE TEMP B-TREE`, unbounded sorter, or full native
collection.

Completion sequence is exact:

1. source cursor finalized and unregistered;
2. all row inserts and counts fenced;
3. rules 1-10 run and each rule cursor is finalized/unregistered;
4. source/main/TEMP catalog identities and owner epoch/count are re-proven;
5. clock high-water is re-read and equals the A2a captured value; it is not
   silently advanced;
6. clean vector only: seal TEMP rows through A1 and exactly match count/root;
7. re-run the non-consuming A2b provenance fence and require the fresh A1
   count/root, exact source identities, A2a clocks, projection object/reference,
   source summary and ownership handles to match its retained witness;
8. store the same input opaque receipt on the stage session without cloning,
   reconstructing or reissuing it;
9. make any second completion or receipt substitution terminal; and
10. transition one way from `active` to `pre-rebind-complete`.

The returned union is private and explicit:

```ts
type SQLiteCursorPreRebindCampaignOutcome =
  | Readonly<{
      status: "pre-rebind-complete";
      projectionIdentity: OperationBaselineProjectionIdentity;
      diagnostics: readonly [];
      receipt: SQLiteCursorPreRebindReceipt; // exact input object
    }>
  | Readonly<{
      status: "diagnosed";
      projectionIdentity: OperationBaselineProjectionIdentity;
      diagnostics: readonly SQLiteCursorDiagnostic[];
    }>;
```

Python mirrors this with two frozen slotted dataclasses or one closed tagged
union. A diagnosed run is terminal and cannot later be retried on the same
stage. A new caller-owned transaction must recapture from the source.

### B3: future publication-owned rebind, explicitly outside Slice B

Only this later segment consumes the exact receipt and a new opaque publication
session. Inside the same still-live EXCLUSIVE owner transaction it executes
0002/publication work, updates exactly `receipt.cursorCount` cursor rows once,
runs rules 11 and 12, reaches `cursor/clock-complete`, audits v2, and commits.
Faults before first update, between publication updates and before commit belong
here, not in B0-B2.

## 4. Transaction, lock and write ownership

Slice B owns no transaction command and no commit/rollback. It requires the
existing owner-observed EXCLUSIVE proof. `BEGIN IMMEDIATE`, deferred, savepoint,
unknown mode, raw transaction control, rollback/rebegin and multi-statement
replacement all fail.

For B0-B2 the “lock” is the SQLite EXCLUSIVE owner lock plus the frozen
migration-lock high-water evidence. No active provider migration-lock session is
currently represented by an opaque runtime capability, so Slice B must not
claim one. The future publication owner must separately freeze the active v1 to
v2 migration-lock ID/owner/epoch/fence and bind it to its publication session
before the first permanent mutation.

Allowed writes in B0-B2 are only:

- one `CREATE TEMP TABLE` DDL with zero row-change delta;
- exactly one TEMP insert per main cursor row; and
- cleanup `DROP TABLE` on the same still-owned transaction generation.

Every other main or TEMP DML is unexplained and terminal. DDL changes the owner
transaction epoch; stage code must accept only its own exact create/drop by
updating the private captured epoch immediately after successful catalog
validation. No caller-visible allowance setter is permitted.

## 5. Fault, cancellation and cleanup matrix

### Required in Slice B acceptance

- before begin/provenance fence: reject with no cursor TEMP object;
- during cursor TEMP creation: best-effort remove only objects created by that
  attempt; preserve primary failure;
- source statement creation, first/middle/final fetch and source close;
- after decode/digest but before insert;
- insert statement failure, zero/multiple reported changes and injected DML;
- after final source row, before count barrier and before seal query;
- seal statement creation, first/middle/final fetch and close;
- every one of ten rule statement creation/fetch/close boundaries;
- after a real diagnostic and at each next-rule transition;
- source or TEMP catalog replacement at capture/decode/insert/seal/rule/
  completion boundaries;
- transaction end, rollback/rebegin, active stage disposal and connection close;
- cancellation at begin, scan, seal, each rule and pre-completion poll;
- cleanup-only failure and primary-plus-cleanup failure, with primary precedence;
- receipt/projection/source/session clone, second run and abandonment.

At most one campaign cursor is registered on the stage at any instant. Transfer
ownership before fetch, clear ownership before the sole close, and make abort,
poison and dispose share one idempotent close path. A close error with no primary
is surfaced and poisons the stage. A close error with a primary is suppressed
after best-effort catalog cleanup. Caller rollback remains mandatory.

Busy/locked acquisition is tested at the owner that executes `BEGIN EXCLUSIVE`;
the campaign is never entered without the lock. Retry starts from a completely
new transaction/source/stage/campaign object graph. It does not reuse a
diagnosed, cancelled or poisoned receipt issuer.

### Connection loss

TypeScript disposal may observe `connection.isOpen === false` and must clear
only in-memory ownership; connection teardown owns TEMP destruction. Python
must harden closed-connection property access so cleanup does not mask the
original unavailable/statement error. Reopen evidence must find no TEMP object
(TEMP is connection-local), unchanged main cursors and no permanent v2 state.

## 6. Scale and crash/replay segmentation

### Fast correctness gate, part of Slice B

Run 128 and 1,024 rows with tenant/token orders deliberately disagreeing.
Record exact counts/root, maximum live raw rows, maximum live decoded snapshots,
fetch sizes, TEMP object count and EQPs. Reject `.all()`, `fetchall()`,
`Array.from`, list/tuple capture proportional to cursor count and application
sorting.

### Scheduled scale gate, separate evidence checkpoint

Run exact 10,000 and 100,000 direct-fixture cursors. The public provider quota
is 4,096, so these are reconciliation stress fixtures inserted by an isolated
fixture loader, not proof that normal APIs can create 100K live cursors.

Record separately for each runtime and size:

- source/TEMP/seal/rule counts and immutable root;
- source and seal max live rows/snapshots;
- p50/p95/p99 and total elapsed time for scan, rules, seal and cleanup;
- peak and baseline RSS, and RSS delta;
- TEMP `page_count`, `page_size`, cache settings and spill behavior;
- main DB, WAL, SHM and process TEMP-file sizes where observable;
- every normalized EQP and SQLite version; and
- clean-repository command, revision and host metadata.

This gate is required before `productionThroughputClaim:true`; it need not block
the first B0/B1 merge.

### Pre-rebind crash/replay gate

Use a subprocess/worker and kill at: after TEMP create, mid-scan, after scan,
mid-rule, after seal and immediately after receipt issuance but before caller
rollback/commit. On reopen prove:

- v1 main bytes/counts and both mutable cursor identities are unchanged;
- no v2 row, 0002 artifact or persisted seal exists;
- connection-local TEMP state disappeared; and
- a fresh EXCLUSIVE transaction recaptures the identical baseline projection,
  A1 immutable root and clean ten-rule vector.

Receipt SHA-256 need not repeat because production ownership nonces may be
fresh; projection and immutable root must repeat. Post-update rollback and
commit crash/recovery belong to B3.

## 7. Exact file and API plan

### TypeScript lane

1. `packages/sqlite/src/operation-baseline-source.ts`
   - add a module-private `WeakMap` registration for genuinely captured summary
     objects;
   - add `assertSQLiteV1BaselineCursorSourceProvenance(summary, connection)`;
   - return frozen exact connection/epoch/clock/envelope witness, not raw SQL.
2. `packages/sqlite/src/operation-baseline-cooperation.ts`
   - add cursor begin/fence/register/release/complete/abort symbols and closed
     stage/source binding interfaces; do not export them from package index.
3. `packages/sqlite/src/operation-baseline-stage.ts`
   - add one-way cursor state, session, active cleanup and stored receipt;
   - add dynamic phase-aware cursor TEMP DDL/catalog identity;
   - own exact +1 TEMP write allowance and cleanup/drop behavior;
   - require exact legacy completion and projection identity at begin.
4. `packages/sqlite/src/operation-baseline-cursor-invariants.ts`
   - factor a private inspection path that computes rule evidence without
     weakening the existing strict A1 decoder/accumulator;
   - keep the current A1 public-to-package APIs and roots unchanged.
5. `packages/sqlite/src/operation-baseline-cursor-ownership.ts`
   - no A2b protocol change is required;
   - optionally add one private helper that compares a fenced provenance witness
     with the campaign-owned exact object graph; do not issue a replacement.
6. `packages/sqlite/src/operation-baseline-cursor-campaign.ts` (new)
   - fixed DDL/query/insert/rule SQL;
   - closed options, diagnostics, discriminated outcome and one-shot executor;
   - accept only the opaque A2b receipt as explicit source context, fence it
     before TEMP creation, and return that exact object on clean completion.
7. `packages/sqlite/test/operation-baseline-cursor-campaign.test.ts` (new)
   - pristine/hostile/rule/EQP/count/root tests.
8. `packages/sqlite/test/operation-baseline-cursor-lifecycle.test.ts` (new)
   - owner, fault, cancel, cleanup, connection-loss and one-shot matrix.

### Python lane

1. `python/src/graph_engineering/sqlite_operation_baseline_source.py`
   - add exact captured-source provenance assertion using the retained private
     connection/epoch/clock object and live owner checks.
2. `python/src/graph_engineering/sqlite_operation_baseline_stage.py`
   - mirror state/session/dynamic catalog/write allowance/cleanup semantics.
3. `python/src/graph_engineering/sqlite_operation_baseline_cursor_invariants.py`
   - mirror the rule inspection result while retaining the exact A1 algorithm.
4. `python/src/graph_engineering/sqlite_operation_baseline_cursor_ownership.py`
   - protocol unchanged; optional exact campaign-witness comparison only.
5. `python/src/graph_engineering/sqlite_operation_baseline_cursor_campaign.py`
   (new)
   - normalized SQL and outcome parity with TypeScript.
6. `python/tests/test_sqlite_operation_baseline_cursor_campaign.py` (new)
   - shared pristine/hostile/rule/EQP/count/root tests.
7. `python/tests/test_sqlite_operation_baseline_cursor_lifecycle.py` (new)
   - full lifecycle/fault/cancel/cleanup parity.

### Main integration/spec lane

After both runtime APIs stabilize, add one literal shared conformance fixture
for the clean and diagnosed outcomes plus normalized hashes for source query,
TEMP DDL, insert, seal query and ten marker queries. Do not flip the existing
54-rule registry's `implementationClaim`, `releaseGate`, cursor `protocolClaim`
or throughput claim in Slice B.

## 8. First red tests and implementation order

The fastest safe sequence is:

1. **Red ownership tests**
   - A2b built from a synthetic TS summary is valid as a pure A2b primitive but
     rejected as a database campaign source;
   - genuine summary + wrong connection rejected before `CREATE TEMP`;
   - genuine source clone, projection clone, stage clone and stale epoch fail;
   - right source before legacy completion fails;
   - second begin and rollback/rebegin fail.
2. **Implement B0 provenance bridge** in source/cooperation/stage only; rerun
   source, handoff, stage and legacy suites.
3. **Red pristine TEMP tests**
   - exact DDL/catalog shape and creation order;
   - main source SQL hash/EQP;
   - empty, one event, event+checkpoint and tenant/token cross-order roots;
   - exact +1 write delta and no raw BLOB columns;
   - source/count/seal mismatch is terminal.
4. **Implement B1 clean capture/seal**, reusing A1 accumulator and requiring
   its fresh count/root to equal the pre-fenced input A2b witness at the final
   clean barrier.
5. **Red diagnostic tests** for each rule independently and exact vector;
   malformed BLOB/scope/clock must reach its rule instead of dying in A1.
6. **Implement B2 inspection flags and rules 1-10** in registry order.
7. **Red lifecycle matrix**, then implement single-owner cursor finalization,
   cancellation polls and dynamic TEMP cleanup.
8. Run 128/1,024 parity, focused and adjacent suites, full TS/Python suites,
   static checks, registry/docs/diff gates and independent severity-zero audit.
9. Merge the 10K/100K and subprocess crash/replay evidence as separate reviewed
   checkpoints. Only then schedule B3 publication/rebind design.

## 9. Acceptance checklist

Slice B is complete only when all of the following are true:

- [ ] exact captured source, connection, stage, projection and epoch are bound;
- [ ] synthetic/equal-value clones cannot enter the database campaign;
- [ ] real main scan is tenant/token and TEMP seal scan is token/tenant;
- [ ] no source BLOB or decoded snapshot survives its row;
- [ ] rules 1-10 run in exact registry order and have exact diagnostic vectors;
- [ ] clean outcome alone returns the exact input opaque A2b receipt;
- [ ] stage reaches only `pre-rebind-complete`;
- [ ] cancellation/fault/cleanup matrix has exact-once cursor closure;
- [ ] 128/1,024 streaming and SQL/EQP parity pass;
- [ ] 10K/100K and pre-rebind crash/replay evidence are recorded separately;
- [ ] both full suites and all static/conformance/document gates pass;
- [ ] independent review reports HIGH 0 / MEDIUM 0 / LOW 0; and
- [ ] no 0002, permanent mutation, rebind, rules 11/12, registry claim,
  production, release, adoption or star claim is made.
