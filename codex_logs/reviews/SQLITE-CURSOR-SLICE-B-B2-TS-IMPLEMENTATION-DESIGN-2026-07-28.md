# SQLite Cursor Slice B / B2 — TypeScript implementation design

Date: 2026-07-28
Status: implementation-ready TypeScript delta; no production/spec/plan change
Authority: the append-only master plan, accepted A1/A2a/A2b/B0b/B1 code and fixtures, and `SQLITE-CURSOR-SLICE-B-DESIGN-AUDIT-2026-07-28.md`

## 1. Exact boundary

B2 starts with the exact opaque A2b receipt, exact B0b transfer session and an
already adopted B1 `temp.ge_blr_cursor_seal`. It streams the v1 cursor catalog,
stages closed carriers, evaluates rules 1–10 in registry order, reproduces the
A1 count/root and ends in private `pre-rebind-complete`. It performs no main DB
write, migration 0002, rebind, rules 11/12, final publication, public export or
implementation-claim flip.

The existing strict A1 decoder is a seal primitive, not a diagnostic reader.
B2 must not call it directly on hostile source rows because its first throw
would suppress the ordered rule vector. A tolerant inspector owns diagnosis;
only an all-green row is converted to `SQLiteCursorSealRow` and admitted to A1.

## 2. Parallel file ownership

| Lane | Files | Output / fence |
| --- | --- | --- |
| TS-1 inspector | add `packages/sqlite/src/operation-baseline-cursor-inspection.ts`; add matching test | no SQL, lifecycle, exports or stage edits; one-row bounded decode only |
| TS-2 campaign | add `packages/sqlite/src/operation-baseline-cursor-campaign.ts`; add matching test | owns fixed source/lookup/rule/seal SQL and report; no direct stage internals |
| TS-3 stage | modify `operation-baseline-cooperation.ts`, `operation-baseline-stage.ts`, `operation-baseline-cursor-stage-ownership.ts`; extend existing stage-owner test | owns symbols, state and exact DML adoption only; no decoder semantics |
| integration | conformance fixture/codegen only after main/spec owner freezes it; package tests and audit | never export B2 from `index.ts`; do not rewrite another lane |

Recommended merge order: TS-1, TS-3, TS-2, fixture binding, hostile/fault tests.

## 3. Private API (exact shape)

Add no public API. Package-private campaign surface:

```ts
export const SQLITE_CURSOR_PRE_REBIND_RULES: readonly {
  readonly ruleId: SQLiteCursorPreRebindRuleId;
  readonly sql: string;
}[];

export interface SQLiteCursorPreRebindDiagnostic {
  readonly ruleId: SQLiteCursorPreRebindRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export type SQLiteCursorPreRebindOutcome =
  | Readonly<{
      status: "pre-rebind-complete";
      projectionIdentity: OperationBaselineProjectionIdentity;
      receipt: SQLiteCursorPreRebindReceipt; // exact input object
      diagnostics: readonly [];
    }>
  | Readonly<{
      status: "diagnosed";
      projectionIdentity: OperationBaselineProjectionIdentity;
      diagnostics: readonly SQLiteCursorPreRebindDiagnostic[];
    }>;

export interface SQLiteCursorPreRebindCampaignOptions {
  readonly diagnosticLimit?: number; // default 16, closed integer 1..64
}

export function runSQLiteCursorPreRebindCampaign(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
  options?: SQLiteCursorPreRebindCampaignOptions,
): SQLiteCursorPreRebindOutcome;
```

The diagnosed branch deliberately has no `receipt` property. Freeze every
returned object/array. Options validation copies the hardened existing campaign
pattern: ordinary direct-key object only, no accessor/proxy/extra/symbol key.

Inspector input is one hardened 18-value row plus frozen receipt evidence. Its
output contains the 20 stage values, ten `0|1` flags and optional all-green A1
row. It never returns BLOB bytes, parsed JSON, summary arrays, raw row or
tenant-controlled diagnostic text. Blob sizes remain A1 bounds (1 MiB request,
16 MiB snapshot); checkpoint entries are walked one at a time, maximum 256.

## 4. New stage symbols and state

Add private symbols/interfaces for `BEGIN_CURSOR_PRE_REBIND`, `FENCE`,
`REGISTER_CLEANUP`, `INSERT_STAGED_CURSOR`, `COMPLETE`, `DIAGNOSE` and `ABORT`.
The insert hook accepts a frozen closed 30-value tuple, never SQL or a statement.

State machine:

```text
B0b active + B1 present
  cursorCampaign unused
    -> scanning -> rules -> sealing -> pre-rebind-complete
                       \-> diagnosed
    any operational/fence/cleanup failure -> poisoned
```

`diagnosed` is a successful data outcome but terminal and non-retryable for the
session. `poisoned` is an operational/corruption failure. Both are disposable;
neither authorizes publication. Completion keeps the original B0b receipt and
transfer identity. A second begin/run/complete/diagnose always fails closed.

Every hook rechecks: exact connection/stage/receipt/transfer/session identity,
EXCLUSIVE owner and epoch, allowed `total_changes`, exact B1 rootpage/SQL/xinfo,
baseline TEMP catalog, main catalog receipt and no other active stage cursor.
Each owned insert must report statement changes `1`, total changes `+1`, epoch
`+0`; the stage adopts that exact new total before the next fence.

The stage owns exactly one active iterator cleanup. Registration is before the
first fetch; close runs exactly once. Stage disposal closes it before dropping
owned TEMP objects. Primary work/fence errors outrank close/drop errors.

## 5. Source/catalog/query order

Capture an exact main-catalog receipt for tables `ge_cycle_cursors`,
`ge_cycle_records`, `ge_cycle_checkpoint_revisions`, `ge_cycle_migration_lock`,
`ge_cycle_schema`, plus named indexes
`ge_cycle_records_stream_sequence_hash_uq` and
`ge_cycle_checkpoint_revisions_lookup_idx`. Store exact type/name/table/rootpage/
normalized SQL and `main.schema_version`. Reprove before and after prepare,
every fetch, semantic lookup, TEMP insert, rule transition, seal fetch and final
transition. Same-shape replacement is terminal even with `total_changes +0`.

Execution order is fixed:

1. validate options and A2b provenance; begin/fence exact B0b/B1 owner;
2. capture/reprove main catalog, schema singleton and migration-lock high-water;
3. read exact main cursor count and require safe integer;
4. assert EQP, prepare the accepted A2b tenant/then-token source SQL;
5. for each row: fence, fetch, inspect/decode/digest/lookups, insert once, release
   raw/decoded values, fence; then close once;
6. repeat main count/high-water/schema/catalog checks;
7. execute rule marker queries in IDs 1..10, each with `limit + 1`;
8. if diagnosed, publish frozen vector and terminal diagnosed state;
9. if clean, stream eligible TEMP carriers in token/then-tenant BINARY order,
   append to A1, finish once, compare every A1 receipt field with A2b;
10. final provenance/catalog/clock/owner fence, then atomic completion.

No `.all()` is allowed on source, lookup, marker or seal paths. No application
sort, automatic index, materialized subquery or TEMP B-tree is accepted by EQP.

## 6. Ten rule marker SQL contracts

All row markers use this suffix and return only integer `1`:
`ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?`.
The exact registry is:

```sql
-- 1 BLR_CURSOR_AUTHORIZATION
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE authorization_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 2 BLR_CURSOR_SCOPE
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE scope_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 3 BLR_CURSOR_BLOB_CANONICAL
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE blobs_canonical_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 4 BLR_CURSOR_POSITION
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE position_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 5 BLR_CURSOR_EXPIRY_CONSUMPTION
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE clock_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 6 BLR_CURSOR_CATALOG_BINDING
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE catalog_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 7 BLR_CURSOR_SEAL_COUNT (one inventory unit, never one per missing row)
SELECT 1 FROM (SELECT count(*) AS staged_count FROM temp.ge_blr_cursor_seal)
WHERE staged_count <> ? OR ? <> ? OR ? <> ? LIMIT ?;
-- 8 BLR_CURSOR_SHAPE
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE shape_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 9 BLR_CURSOR_EVENT_BINDING
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE event_binding_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
-- 10 BLR_CURSOR_CHECKPOINT_BINDING
SELECT 1 FROM temp.ge_blr_cursor_seal WHERE checkpoint_binding_ok = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?;
```

Rule 7 binds staged count, pre/post main count, walked count and A2b count in a
frozen positional parameter contract. It emits 0 or 1. `seal_eligible` must
equal the conjunction of row flags; unexplained disagreement is also rule 7,
but an explained semantic failure must not manufacture an extra count failure.

Semantic lookups are exact and bounded:

```sql
SELECT 1 FROM main.ge_cycle_records
 INDEXED BY ge_cycle_records_stream_sequence_hash_uq
 WHERE tenant_id=? AND stream_id=? AND sequence=? AND record_hash=? LIMIT 1;

SELECT summary_blob FROM main.ge_cycle_checkpoint_revisions
 INDEXED BY ge_cycle_checkpoint_revisions_lookup_idx
 WHERE tenant_id=? AND checkpoint_scope=? AND checkpoint_id=?
   AND action='put' LIMIT 2;
```

For checkpoint summaries require exactly one byte-identical canonical
`summary_blob` and strict order: bound sequence DESC, created-at DESC,
checkpoint ID ASC under unsigned UTF-8/BINARY comparison. Later current-row
mutation/delete is permitted. Event empty tail is sequence `-1`, null hash,
`next_position=0`; nonempty tail must exactly bind retained history while a
later stream head is permitted. Page size is 1..256; checkpoint position is
0..snapshot length; event position is 0..tail sequence for nonempty snapshots.

## 7. Diagnostic and failure precedence

Diagnostics are appended only in registry order, omit zero-count rules and use
`violationCount=min(actual, limit)`, `diagnosticsTruncated=actual>limit`; a
marker cursor reads at most `limit+1`. There is no continuation token and no
tenant identity in the report.

Precedence, highest first:

1. provenance/connection/stage/session substitution or owner/epoch loss;
2. catalog/plan/statement contract corruption and unexplained write delta;
3. source fetch/decode infrastructure failure (not a row diagnostic);
4. primary TEMP insert/lookup/marker/seal failure;
5. malformed marker or impossible staged tuple;
6. A1 count/root/source-identity mismatch;
7. expected ordered diagnostic outcome;
8. iterator/statement cleanup-only failure;
9. TEMP cleanup-only failure during later disposal.

When primary and cleanup fail, throw the primary and burn/poison state; cleanup
is attempted once and never masks it. Busy/locked/connection loss are structured
provider failures and poison this one-shot owner. Synchronous B2 has cooperative
pre-step cancellation only; it makes no claim that another event-loop task can
interrupt an in-flight native SQLite call.

## 8. Tolerant inspection rule allocation

The inspector evaluates all independent booleans without short-circuiting:
authorization (identifiers and four hashes); scope (kind/null groups and exact
closed request tuple); canonical blobs; position; cursor clocks against frozen
provider high-water; descriptor/schema binding; physical shape; event binding;
checkpoint binding. Expiry never raises provider high-water. Cursor created and
consumed must be at/below it; capture must be at/above rechecked high-water,
which remains at/above the accepted non-cursor maximum.

Because A2b was minted through strict A1 decoding under an exact STRICT source
catalog, B2 does not invent surrogate cursor identities. A row that cannot be
represented by B1's typed key is evidence that the accepted provenance/catalog
boundary has been violated and is terminal. Lexically hostile but correctly
typed rows remain stageable and produce ordered flags. This avoids a new,
unreviewed cross-language surrogate hash protocol.

## 9. A1/root completion

Only when the diagnostic vector is empty and all physical counts agree, query:

```sql
SELECT token_hash,tenant_id,kind,principal_hash,authorization_hash,
 stream_id,checkpoint_scope,request_scope_byte_length,
 request_scope_blob_sha256,page_size,next_position,snapshot_tail_sequence,
 snapshot_tail_record_hash,snapshot_byte_length,snapshot_blob_sha256,
 created_at_ms,expires_at_ms,consumed_at_ms,descriptor_hash,
 schema_identity_sha256
FROM temp.ge_blr_cursor_seal WHERE seal_eligible=1
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY;
```

Require EQP to use the WITHOUT ROWID primary key with no sort. Reconstruct one
strict A1 row carrier at a time, append once, close once, finish once. Cursor
count, immutable root, source descriptor and source schema must exactly equal
the A2b witness. Return the same opaque receipt object, not a scalar clone.

## 10. Minimum red-test order

1. private API/non-export, frozen registry order and options 1/16/64 plus hostile
   accessor/proxy/extra-key cases;
2. pristine empty/event/checkpoint/mixed fixtures reproduce accepted A1 roots;
3. one hostile vector per rule, then multi-rule row, exact 10-number order and
   truncation at 1/16/64;
4. token-first/tenant-second disagreement, same token across tenants, empty and
   nonempty event tails, later stream append, checkpoint later-current mutation,
   missing/reordered historical revisions;
5. exact main/source/TEMP counts; missing/extra/count-preserving substitution;
6. source and seal constant-space proofs at 128 and 1,024 rows and captured EQPs;
7. parameterized mutation before/after prepare, first/middle/final fetch, lookup,
   insert, all ten marker create/fetch/close points, seal first/middle/final and
   completion;
8. same-name/same-shape DDL replacement, unexplained +1 write, transaction
   replacement, wrong receipt/transfer/stage/connection and replay;
9. active disposal and primary-vs-cleanup precedence; no leaked iterator/TEMP;
10. full package regression, typecheck, lint, build, diff check and independent
    severity HIGH 0 / MEDIUM 0 / LOW 0 review.

The first implementation PR should stop after tests 1–5 and focused green; the
second owns lifecycle/fault matrix; the third owns fixture parity and gates.

## 11. Required gates and nonclaims

Focused new tests, all 20 existing SQLite test files plus new files, package
typecheck/lint/build and `git diff --check` must pass. Cross-language fixture,
normalized SQL/hash parity and Python gates are required before B2 acceptance,
but are owned by their separate lane. Fast evidence is 128/1,024; 10K/100K RSS,
crash/replay, async interruption, migration/rebind, rules 11/12,
`cursor/clock-complete`, registry claim, release/adoption and star count remain
explicitly open.

## 12. Self-review

The blueprint preserves the exact A2b object and B0b owner, avoids public API
growth, keeps blobs/decoded snapshots one-row bounded, uses deterministic code
for plumbing, keeps all failures structured, prevents retry/re-entry, fixes the
strict-A1-versus-diagnostic-reader conflict, preserves rules 1–10 ordering and
does not cross the publication boundary. Remaining cross-runtime decision is
only fixture freezing; no production implementation is claimed by this log.
