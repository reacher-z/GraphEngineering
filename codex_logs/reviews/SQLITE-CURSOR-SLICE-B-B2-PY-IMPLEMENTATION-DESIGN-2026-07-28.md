# SQLite Cursor Slice B2 Python implementation design

Date: 2026-07-28
Status: implementation-ready architecture; no production claim
Lane: Python private SQLite reconciliation only
Authoritative inputs: master-plan §§31.34.44–45, 31.34.48–49,
31.35.3–4, 31.35.7, 31.35.9 and 31.35.11; the accepted B0b/B1 design and
severity-zero audit; current Python A1, A2b, B0a, B0b/B1, stage and predecessor
campaign implementations.

This document changes no protocol, registry, migration, permanent schema or
public API. It designs B2 only: production cursor-row inspection, bounded
rules 1–10, production A1-root reproduction and a private one-way
`pre-rebind-complete` or `diagnosed` terminal.

## 1. Frozen decision

B2 starts from the exact already-active B0b transfer after B1 has created and
catalog-bound `temp.ge_blr_cursor_seal`. It must not create a parallel source,
receipt, projection, stage or connection authority. Its only explicit source
authority is the exact input `SQLiteCursorPreRebindReceipt`; its live database
authority is the exact registered B0b transfer and its hidden stage session.

B2 performs these operations in order:

1. validate closed options without touching SQLite;
2. run the non-consuming A2b receipt fence;
3. revalidate the exact B0b transfer and B1 catalog;
4. mint exactly one registered B2 campaign capability and burn the stage's B2
   one-shot latch;
5. stream the frozen 18-column main cursor projection in tenant/token physical
   order, one row at a time;
6. inspect the row without allowing A1's strict decoder to steal rule-owned
   diagnostics;
7. insert one blob-free 30-column evidence row into the B1 TEMP table and
   adopt exactly one `total_changes + 1` delta;
8. prove main/source/TEMP counts and then run the ten registered rules in
   frozen order with bounded marker reads;
9. if any diagnostic exists, return only a safe `diagnosed` outcome and make
   the stage terminal for this transaction;
10. on the clean vector, stream seal-eligible TEMP rows in token/tenant order
    into the existing A1 accumulator, compare the fresh count/root and source
    identities with the retained A2b witness, repeat every owner fence, store
    the exact input receipt object, and transition exactly once to
    `pre-rebind-complete`.

There is no retry on the same stage. Diagnosed, cancelled, abandoned and
poisoned runs require caller rollback and a completely new connection/source/
stage/receipt/transfer object graph.

## 2. Existing invariants that B2 must preserve

### 2.1 A1 is the only seal implementation

`sqlite_operation_baseline_cursor_invariants.py` already freezes:

- the exact 18 physical fields and 16 immutable fields;
- the exact 18-contribution blob-free carrier;
- request-scope maximum 1,048,576 bytes and snapshot maximum 16,777,216 bytes;
- token-hash bytes followed by tenant bytes as canonical order;
- row and seal domains, length framing, recurrence, empty root and terminal
  formula;
- descriptor and schema identities as receipt bindings outside the immutable
  root;
- atomic append, exact expected count, duplicate/order rejection and one-shot
  finish.

B2 must construct genuine `SQLiteCursorSealRow` objects from clean TEMP rows
and call `SQLiteCursorSealAccumulator`. It must not copy the hash algorithm,
canonical document, ordering comparison or finish logic into the campaign.

The strict A1 decoder is not the B2 inspection API. It raises before Rules 2,
3, 5 and 8 can own malformed scope/blob/clock/shape evidence. B2 therefore
adds a private non-throwing semantic inspection result for row-owned
violations. Fatal Python/SQLite/resource errors still throw; malformed source
data becomes flags plus `seal_row=None`.

### 2.2 A2b remains exact-identity authority

`assert_sqlite_cursor_pre_rebind_receipt_provenance` must run first at every
public-to-private campaign entry. B2 derives from its returned witness only:

- exact source summary and exact clock object;
- retained A1 receipt;
- exact baseline projection identity and opaque projection reference;
- exact capture session;
- exact tenant, source-stage, campaign and connection capability objects.

No scalar copy of a receipt root, count, hash, epoch or clock is an authority.
No new A2b issuer is constructed. Clean completion returns the same input
receipt object (`outcome.receipt is receipt`).

### 2.3 B0b/B1 remains the live owner

The B0b transfer already binds exact receipt, source witness, connection,
stage, projection and private stage session. B1 already owns the only accepted
DDL transition and exact 30-column STRICT/WITHOUT ROWID catalog. B2 must use a
captured unbound intrinsic to turn that active transfer into one B2 capability;
it must never read `_TRANSFERS` directly from the campaign module and must
never rerun the now-historical B0a live capture-epoch assertion.

The immutable capture epoch remains unchanged. The live stage epoch remains
the B1-adopted epoch throughout B2 because B2 performs DML and SELECT only.
The stage allowed-change counter advances by exactly one per owned TEMP insert.

## 3. Exact private Python surfaces

Nothing below is exported from `graph_engineering.__init__`.

### 3.1 Cursor inspection additions

Extend `sqlite_operation_baseline_cursor_invariants.py` with:

```python
@dataclass(frozen=True, slots=True)
class _SQLiteCursorRowInspection:
    staged_values: tuple[object, ...]       # exactly the 20 carrier/identity values
    authorization_ok: bool
    scope_ok: bool
    blobs_canonical_ok: bool
    position_ok: bool
    clock_ok: bool
    catalog_ok: bool
    shape_ok: bool
    event_binding_ok: bool
    checkpoint_binding_ok: bool
    seal_row: SQLiteCursorSealRow | None

def _inspect_sqlite_v1_cursor_row(
    row: object,
    *,
    source_descriptor_hash: str,
    source_schema_identity_sha256: str,
    provider_high_water_at_ms: int,
    event_tail_exists: Callable[[str, str, int, str], bool],
    checkpoint_revision_exists: Callable[[str, str, str, bytes], bool],
) -> _SQLiteCursorRowInspection: ...
```

The callable arguments are closed campaign-owned adapters, not caller hooks.
The implementation may instead pass a private exact context object if that
avoids public callables. Either form must remain module-private and captured
before hostile class replacement.

Inspection rules:

- wrong top-level type/arity sets `shape_ok=False` and uses deterministic safe
  staging placeholders; it never calls the strict decoder;
- required SQLite storage class/nullability errors set `shape_ok=False`;
- identifier/hash lexical failures set Rule 1 false independently;
- scope and decoded request tuple failures set Rule 2 false;
- raw BLOB bound/UTF-8/duplicate-key/BOM/nonportable/canonical-byte failures set
  Rule 3 false;
- integer range and snapshot-position failures set Rule 4 false;
- local lifecycle/provider-clock failures set Rule 5 false;
- descriptor/schema mismatches set Rule 6 false;
- event and checkpoint semantic/history checks set Rules 9/10 independently;
- `seal_row` exists only when every A1 prerequisite and every immutable shape
  check succeeds; `seal_eligible` is exactly `int(seal_row is not None and all
  row rules are true)`.

Invalid values staged only for diagnosed runs use deterministic internal
placeholders derived from source ordinal and typed SHA-256 framing. They must
be safe TEXT/INTEGER values, collision-resistant inside one campaign, contain
no raw tenant payload, and be identical across runtimes if later placed in a
shared fixture. They never contribute to an A1 root. Exact-schema production
rows normally retain their real scalar/digest values.

The two BLOBs are referenced only for the current row. After lengths, digests,
canonical decoding and any event/checkpoint checks are complete, delete raw
BLOB and decoded-object references before the next source fetch. At most one
decoded checkpoint snapshot is live. This is constant-row-count memory, not a
claim that Python's SQLite driver incrementally streams one BLOB: `fetchone()`
materializes the current schema-bounded BLOB. The implementation must not
claim blob-level streaming or accept proportional row retention.

### 3.2 Exact registered B2 capability

Extend `sqlite_operation_baseline_cursor_stage_ownership.py` with an empty,
exact-type, weak-referenceable capability:

```python
class _SQLiteCursorPreRebindCampaignAuthority:
    __slots__ = ("__weakref__",)

@dataclass(frozen=True, slots=True)
class _CampaignAuthorityMetadata:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    transfer: _SQLiteCursorStageOwnershipTransfer
    transfer_session: object
    campaign_session: object
```

A `WeakKeyDictionary` stores metadata by exact capability identity. The only
minting entry is:

```python
def _begin_sqlite_cursor_pre_rebind_campaign(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: _SQLiteCursorStageOwnershipTransfer,
) -> _SQLiteCursorPreRebindCampaignAuthority: ...
```

Order is A2b fence, exact transfer fence, exact B1-catalog-present assertion,
allocate prospective objects, stage begin, capability registration, return.
The stage latch is published only after the final transfer fence. After source
authority is accepted, a wrong stage/session/phase attempt burns the B2 latch.

Provide closed wrappers, each revalidating exact registered capability context
before invoking a captured unbound stage intrinsic:

```python
_assert_sqlite_cursor_pre_rebind_campaign(..., authority) -> None
_register_sqlite_cursor_campaign_cursor(..., authority, cursor, role, rule_index) -> None
_finalize_sqlite_cursor_campaign_cursor(
    ..., authority, cursor, *, primary: BaseException | None
) -> None
_adopt_sqlite_cursor_campaign_insert(..., authority, before_changes, rowcount) -> None
_complete_sqlite_cursor_pre_rebind_campaign(
    ..., authority, outcome_kind, fresh_seal_receipt
) -> None
_abort_sqlite_cursor_pre_rebind_campaign(
    ..., authority | None, primary: BaseException
) -> Never
```

No wrapper exposes the hidden transfer or campaign session. Capabilities from
another fixture, shallow/deep copies, manual construction, subclassing,
pickle, equal scalar objects and stale weak entries fail.

### 3.3 Stage state and intrinsics

Add these logical fields to `SQLiteV1BaselineTempStage`:

```text
_cursor_campaign_state:
  unused | active | pre-rebind-complete | diagnosed | poisoned
_cursor_campaign_session: object | None
_cursor_campaign_receipt: exact receipt | None
_cursor_campaign_projection: exact projection | None
_cursor_campaign_active_cursor: exact cursor | None
_cursor_campaign_cursor_role: source | seal | rule | None
_cursor_campaign_rule_index: int | None
_cursor_campaign_source_rows: int
_cursor_campaign_main_count: int | None
_cursor_campaign_temp_count: int | None
_cursor_campaign_seal_eligible_count: int | None
_cursor_campaign_fresh_a1: SQLiteCursorImmutableSealReceipt | None
```

Required exact unbound methods:

```python
_begin_cursor_pre_rebind_campaign(connection, receipt, transfer_session) -> object
_assert_cursor_pre_rebind_campaign(connection, receipt, campaign_session) -> None
_register_cursor_campaign_cursor(session, cursor, role, rule_index) -> None
_finalize_cursor_campaign_cursor(session, cursor, primary) -> None
_adopt_cursor_campaign_insert(session, before_changes, rowcount) -> None
_complete_cursor_pre_rebind_campaign(session, receipt, outcome_kind, fresh_a1) -> None
_abort_cursor_pre_rebind_campaign(session, primary) -> Never
```

Freeze these function objects immediately after class construction, as B0b/B1
already do. The campaign module and ownership coordinator call the frozen
copies; later monkeypatching of class methods/properties cannot replace them.

State transitions are one-way:

```text
B1 transfer active + B1 catalog present
  -> cursor campaign active
  -> pre-rebind-complete   (clean only, exact receipt stored)
  -> diagnosed             (one or more safe diagnostics, no receipt stored)
  -> poisoned              (infrastructure/owner/cancel/cleanup failure)
```

There is no transition from diagnosed to active, no second completion, and no
`cursor/clock-complete` state in B2. Stage disposal treats active, diagnosed
and pre-rebind-complete as cursor-owned phases and drops the cursor seal table
through the existing reverse-owned cleanup path.

## 4. Campaign module and outcome

Add `sqlite_operation_baseline_cursor_campaign.py`.

```python
DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 16
MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT = 64

SQLiteCursorRuleId = Literal[
    "BLR_CURSOR_AUTHORIZATION",
    "BLR_CURSOR_SCOPE",
    "BLR_CURSOR_BLOB_CANONICAL",
    "BLR_CURSOR_POSITION",
    "BLR_CURSOR_EXPIRY_CONSUMPTION",
    "BLR_CURSOR_CATALOG_BINDING",
    "BLR_CURSOR_SEAL_COUNT",
    "BLR_CURSOR_SHAPE",
    "BLR_CURSOR_EVENT_BINDING",
    "BLR_CURSOR_CHECKPOINT_BINDING",
]

@dataclass(frozen=True, slots=True)
class SQLiteCursorDiagnostic:
    rule_id: SQLiteCursorRuleId
    violation_count: int
    diagnostics_truncated: bool

@dataclass(frozen=True, slots=True)
class SQLiteCursorPreRebindComplete:
    status: Literal["pre-rebind-complete"]
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[()]
    receipt: SQLiteCursorPreRebindReceipt

@dataclass(frozen=True, slots=True)
class SQLiteCursorDiagnosed:
    status: Literal["diagnosed"]
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteCursorDiagnostic, ...]
```

Use two distinct frozen slotted classes. The diagnosed type has no `receipt`,
root or receipt-hash field. The clean outcome has an exact empty diagnostics
tuple and the exact input receipt. Both types remain package-private even if
their class names are not underscored for consistency with predecessor tests.

The one-shot executor constructor accepts exactly connection, stage, receipt,
transfer and closed options. It accepts no summary, projection, clock, source
identity, expected count/root, capability or SQL callback.

## 5. SQL ownership and bounded reads

### 5.1 Fixed source and insert

Use `SQLITE_CURSOR_MAIN_PROJECTION_SQL` byte-for-byte; its normalized SHA-256
remains `dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4`.
The source walker calls `fetchone()` only. It never calls `fetchall`, `fetchmany`
with an unbounded size, `list(cursor)`, tuple/list capture, application sort or
an ORM materializer.

The TEMP insert is one frozen 30-column statement with 30 positional values:
the 20 blob-free carrier/identity columns followed by nine rule flags and
`seal_eligible`. For every row:

1. fence before execute;
2. snapshot allowed changes;
3. execute exact insert;
4. close its statement result adjacent to execute;
5. require `rowcount == 1` and live `total_changes == before + 1`;
6. stage adopts only that exact +1;
7. fence again before the next source fetch.

The source read cursor remains the sole registered long-lived campaign cursor.
An insert/lookup statement result is an adjacent statement carrier, closed
before control returns to the source loop; it is never retained or exposed.
Tests count and fault every such close. This design claims one registered
witness cursor and bounded statement carriers, not that CPython has only one
native cursor object at every instruction.

### 5.2 Supporting semantic lookups

Event binding uses one fixed exact retained-record lookup by tenant, stream,
sequence and record hash with `LIMIT 2`; zero means missing, one means exact,
two is corruption. It never compares the later current stream head.

Checkpoint binding encodes each decoded summary with the existing provider
codec and uses a fixed exact historical `put` lookup on tenant, scope,
checkpoint ID and canonical `summary_blob`, also `LIMIT 2`. Later current-row
mutation/deletion is allowed. Snapshot order is exactly:

```text
boundSequence DESC, createdAt DESC, checkpointId ASC
```

Comparison of IDs is unsigned UTF-8/BINARY, never locale order.

Every lookup is fenced before open, before/after each bounded fetch and after
close. Main catalog identity covers `ge_cycle_cursors`, `ge_cycle_records`,
`ge_cycle_checkpoint_revisions`, `ge_cycle_migration_lock`, `ge_cycle_schema`
and every named index forced by an accepted EQP. Schema version, type/name/
table/rootpage/SQL and required table/index metadata are re-proved at source,
decode, insert, rule, seal and completion boundaries. Replacement catalog is a
terminal owner error, never Rule 6 or Rule 8.

### 5.3 Ten rule marker definitions

The frozen registry order is:

1. `BLR_CURSOR_AUTHORIZATION` -> `authorization_ok = 0`;
2. `BLR_CURSOR_SCOPE` -> `scope_ok = 0`;
3. `BLR_CURSOR_BLOB_CANONICAL` -> `blobs_canonical_ok = 0`;
4. `BLR_CURSOR_POSITION` -> `position_ok = 0`;
5. `BLR_CURSOR_EXPIRY_CONSUMPTION` -> `clock_ok = 0`;
6. `BLR_CURSOR_CATALOG_BINDING` -> `catalog_ok = 0`;
7. `BLR_CURSOR_SEAL_COUNT` -> one campaign-global inventory unit;
8. `BLR_CURSOR_SHAPE` -> `shape_ok = 0`;
9. `BLR_CURSOR_EVENT_BINDING` -> `kind = 'event' AND event_binding_ok = 0`;
10. `BLR_CURSOR_CHECKPOINT_BINDING` -> `kind = 'checkpoint' AND
    checkpoint_binding_ok = 0`.

Row marker SQL has one `LIMIT ?` parameter, always bound to
`diagnostic_limit + 1`, and orders by token hash then tenant using BINARY. The
accepted EQP decides whether an explicit `INDEXED BY` spelling is retained;
do not guess the WITHOUT ROWID auto-index name. Accepted plans contain no
`AUTOMATIC`, `MATERIALIZE`, `USE TEMP B-TREE` or unbounded sorter.

Rule 7 is not a missing-row marker query. It is exactly one global unit when
these are not all equal:

```text
retained A2b cursor count
== main count captured before source walk
== source rows fetched
== TEMP rows after inserts
== seal-eligible rows on a clean vector
```

It reports count 1, truncation false. It never emits one unit per missing row.
On a clean vector, the fresh A1 accumulator count is added to this equality
before completion. Root mismatch with equal count is a terminal failure of the
retained A2b proof in B2, not an implementation of future Rule 12.

For row rules, fetch at most `limit + 1` marker rows. The diagnostic contains
`min(observed, limit)` and `observed > limit`; it does not run `count(*)` to
recover the hidden total. Each source row has one boolean per rule, so it can
contribute at most one unit per rule. Multiple distinct rule failures for one
row are allowed and remain visible in registry order.

## 6. Rule-specific semantics

### Rule 1 — authorization

Validate tenant as the closed safe identifier, token/principal/authorization
as lowercase 64-hex. Never reconstruct, query or log token plaintext. Tenant
capability means the whole connection namespace, not one tenant.

### Rule 2 — scope

Event: exact non-null stream, null checkpoint scope and exact canonical
`{contractVersion, streamId, pageSize}` request object. Checkpoint: null stream,
exact non-null scope and exact canonical
`{contractVersion, checkpointScope, pageSize}`. Physical null-group CHECK
success alone is insufficient.

### Rule 3 — canonical BLOBs

Both values must be exact bytes, inside frozen bounds, valid UTF-8 without BOM,
valid portable JSON without duplicate keys/nonfinite constants, and byte-equal
to canonical re-encoding. Only length and lowercase SHA-256 enter TEMP.

### Rule 4 — position

Page size is integer 1..256 and next position is safe integer >=0. Empty event
snapshot requires position 0. Nonempty event requires position no greater than
the frozen tail window. Checkpoint requires position no greater than decoded
snapshot length.

### Rule 5 — expiry/consumption and provider clocks

Created/expiry/optional consumption are safe integers; expiry is strictly
after creation; consumption is absent or at/after creation. Created and
non-null consumption must not exceed the frozen provider high-water. Expiry is
not a provider-observation clock. Re-read provider high-water must equal A2a's
frozen value. A changed row/catalog/transaction is terminal; a cursor-owned
clock above an otherwise unchanged frozen high-water is this rule's row unit.

### Rule 6 — catalog binding

The row's descriptor and schema identity equal exact retained A2b source
identities. Caller input cannot supply targets. Main/TEMP object replacement is
terminal rather than a Rule 6 unit.

### Rule 7 — seal count

Use the single global inventory unit defined above. Do not conflate it with
physical row shape, post-rebind affected rows or immutable-root mismatch.

### Rule 8 — physical shape

Own exact arity, SQLite storage classes, required/null physical groups and
lexical/storage properties not allocated to semantic rules. Keep this flag
independent: one hostile row can set both shape and another semantic flag.
Exact catalog replacement remains terminal before row inspection.

### Rule 9 — event history

Canonical snapshot must exactly equal `{exists, sequence, recordHash}` derived
from the frozen tail tuple. Empty is exactly false/-1/null and needs no record.
Nonempty is true/nonnegative/lowercase hash and needs one exact retained record
for tenant/stream/sequence/hash. Later stream-head or record append is allowed.

### Rule 10 — checkpoint history

Snapshot must be a canonical list of exact provider checkpoint summaries. Each
summary must have an exact historical same-tenant/scope/ID `put` revision whose
canonical `summary_blob` matches. Order is sequence DESC, creation DESC, ID
ASC. Later current mutation/deletion is allowed.

## 7. Deterministic page, diagnostic and error order

There is no public continuation token in B2. “Page” means a bounded marker
read of `diagnostic_limit + 1` in canonical TEMP-key order.

Deterministic ordering is:

1. option/type errors before database access;
2. A2b receipt provenance before connection/stage/transfer observations;
3. exact transfer/B1 phase before B2 latch;
4. owner/catalog/cancellation fence before statement creation;
5. source rows tenant/token; TEMP markers and A1 rows token/tenant;
6. rules exactly 1 through 10;
7. diagnostics include only nonzero rules in registry order;
8. within a rule, marker rows are canonical, but row identities are never
   exposed, so only capped count/truncation is observable;
9. diagnosed outcome only after all ten rule cursors close and final fences
   pass;
10. clean outcome only after fresh A1 equality and final A2b/owner fences.

An owner/catalog/transaction/statement/cancellation failure is never converted
to a partial diagnostic outcome. An invalid A2b receipt remains authoritative
even if the connection is closed or stage disposed.

## 8. Resource, exception and cleanup contract

Every source, lookup, marker and seal cursor follows one helper:

1. fence;
2. create exact cursor;
3. fence;
4. register exact cursor/role/rule index before first fetch;
5. bounded fetch loop with cancellation and owner fences before and after each
   fetch;
6. clear stage cursor ownership before the sole close attempt;
7. close exactly once;
8. if no primary, surface close failure and poison;
9. if a primary exists, retain it, suppress close failure after recording only
   safe test telemetry, then abort/cleanup;
10. fence after successful close.

Primary precedence is strict:

```text
A2b/authority > owner/catalog/transaction > cancellation > statement/open/
fetch/decode/insert/rule/seal/completion > cursor close > TEMP drop/residue
```

“Earlier in the actual execution path” is authoritative within a level. A
cleanup exception never replaces an existing primary. Without a primary,
cursor close or cleanup residue is surfaced and poisons the stage.

Abort clears campaign cursor/session/receipt/projection ownership exactly once,
then best-effort drops only the owned cursor TEMP table through stage disposal.
It never deletes or modifies main rows. Closed Python connection/property
access is normalized to a B2-owned `ValueError` and cannot mask the primary.
If connection teardown already destroyed TEMP state, clear only in-memory
ownership after proving no safe SQL cleanup remains possible. Never report
disposed while reserved objects are observably present on a still-open owner.

Cancellation is cooperative only at B2 boundaries: begin, cursor open,
before/after fetch, before/after insert, between rules, seal loop and final
completion. It must use an exact package-private cancellation capability or a
captured closed probe followed immediately by a fence. B2 does not claim
cross-thread SQLite interruption or progress-handler cancellation.

## 9. Hostile test matrix

Add `test_sqlite_operation_baseline_cursor_campaign.py` for semantic/root tests
and `test_sqlite_operation_baseline_cursor_lifecycle.py` for ownership/faults.

### 9.1 Authority and state red tests

1. invalid receipt on closed connection fails A2b first, no B2 latch;
2. equal-value receipt/source/projection/transfer clones fail;
3. wrong connection/stage/transfer/session fail before source cursor;
4. B2 before B1 catalog fails terminally;
5. second begin, second run, second completion and receipt substitution fail;
6. diagnosed and abandoned stage cannot retry;
7. transfer/campaign shallow/deep copy, pickle, manual token/slot and subclass
   attempts fail exact weak registration;
8. class method/property monkeypatch after intrinsic capture cannot replace
   begin/fence/register/finalize/insert/complete/abort.

### 9.2 Clean production-root red tests

9. empty real main table reproduces frozen empty A1 root;
10. literal event, checkpoint, ordered pair and 1,024 fleet reproduce existing
    roots from actual main rows through TEMP, not generated A1 iterables;
11. tenant/token physical and canonical seal orders deliberately disagree;
12. fresh receipt count/root/source identities exactly equal retained A2b;
13. outcome returns the exact input receipt and exact projection object;
14. no raw BLOB/decoded snapshot is stored in TEMP or retained across rows;
15. mutable descriptor/schema-only change leaves theoretical immutable root
    unchanged but diagnoses Rule 6 and returns no receipt.

### 9.3 Ten independent rule red tests

16. one fixture per Rule 1–10 with exact vector and safe fields only;
17. one hostile row violating multiple rules preserves every applicable rule
    in registry order;
18. Rule 7 equal-count substitution, missing, extra and seal-ineligible counts
    each emit one global unit only;
19. event empty/nonempty, retained/missing tail and later append cases;
20. checkpoint exact historical put, missing put, wrong tenant/scope/ID/blob,
    sequence/creation/ID tie-breaks and later current mutation/delete;
21. cursor created/consumed above provider high-water, expiry exclusions and
    safe-integer edges;
22. invalid UTF-8, BOM, duplicate key, NaN/Infinity, whitespace/key order,
    oversized request/snapshot, same-length content drift;
23. diagnostic limit 1, default, max, invalid 0/max+1/bool/float; exactly limit
    and limit+1 markers prove truncation;
24. diagnostics contain no tenant/token/BLOB/plaintext/dynamic exception text.

### 9.4 Epoch/change/catalog hostile tests

25. unexplained main or TEMP DML before every source fetch, after decode,
    before/after insert, each rule, seal and completion is terminal;
26. insert rowcount 0/2, global delta +0/+2 and exception after real insert;
27. rollback/rebegin, PRAGMA epoch move, transaction mode loss and connection
    close at every boundary;
28. same-name/equal-shape cursor table replacement, rootpage/SQL/xinfo drift,
    baseline object replacement and extra/missing reserved object;
29. main cursor/record/checkpoint/migration-lock/schema table or required index
    replacement with equal row counts;
30. captured epoch remains immutable while live epoch/count stay exact.

### 9.5 Cursor/cleanup fault tests

31. source/lookup/insert/rule/seal statement creation failure;
32. first/middle/final fetch failure for source and seal;
33. creation/fetch/close failure for every Rule 1–10 cursor;
34. decode/digest failure before insert and post-insert fence failure;
35. after final source row, before count, after a real diagnostic, each
    next-rule transition and before A1 finish;
36. close failure with no primary is surfaced and poisons;
37. close failure with a primary preserves the primary;
38. drop failure with no primary is surfaced; primary plus drop failure keeps
    primary and reports residue only through safe state;
39. active stage disposal finalizes the exact cursor once; connection loss
    clears in-memory owner and reopen finds no TEMP/permanent mutation;
40. cancellation at begin, scan, insert, each rule, seal and completion is
    terminal and leak-free.

## 10. File ownership and parallel implementation lanes

### Lane P1 — inspection and pure semantics

Owns only:

- `python/src/graph_engineering/sqlite_operation_baseline_cursor_invariants.py`;
- a new focused inspection test file if separation helps.

Implements `_SQLiteCursorRowInspection`, bounded canonical decode adapters,
rule booleans and clean `SQLiteCursorSealRow` production. Must not touch stage,
ownership, spec or master plan.

### Lane P2 — stage capability and lifecycle

Owns only:

- `python/src/graph_engineering/sqlite_operation_baseline_stage.py`;
- `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py`;
- lifecycle-focused tests.

Implements exact registered campaign authority, state machine, active cursor,
insert allowance, completion/abort/disposal and captured intrinsics. Must not
write campaign SQL or alter A1.

### Lane P3 — campaign executor and SQL

Starts after P1/P2 surfaces are frozen; owns only:

- new `python/src/graph_engineering/sqlite_operation_baseline_cursor_campaign.py`;
- new `python/tests/test_sqlite_operation_baseline_cursor_campaign.py`;
- new `python/tests/test_sqlite_operation_baseline_cursor_lifecycle.py` if not
  already owned by P2 through an explicit handoff.

Implements fixed source/insert/lookups/marker/seal SQL, deterministic rule
loop, outcomes and root comparison. It does not access stage fields or weak
registries directly.

### Integration/audit lane

The main agent alone owns shared fixture/spec/plan/log updates. After Python is
stable, parity audit compares normalized SQL, rule order, result shapes,
diagnostic vectors, A1 roots, error precedence and nonclaims with TypeScript.

## 11. Red-test and implementation order

1. Write exact-type/clone/phase red tests for the B2 authority and state latch.
2. Implement P2 authority and active cursor finalize semantics; rerun B0b/B1
   focused suite before any scan code.
3. Write pure inspection red tests for each field/rule and strict-A1 separation.
4. Implement P1 inspection; prove existing A1 31/31-style roots unchanged.
5. Write empty/event/pair production-root tests using real main rows and B1
   TEMP table.
6. Implement source stream, TEMP insert and Rule 7 count barrier.
7. Write one independent hostile fixture per Rule 1–10 plus exact multi-rule
   vector and limit/truncation tests.
8. Implement fixed marker registry and semantic lookups in exact order.
9. Write fresh-A1/A2b substitution and one-shot completion tests; implement
   clean versus diagnosed outcomes.
10. Parameterize statement/fetch/close/epoch/change/catalog/cancel faults over
    every phase; close every primary-precedence gap.
11. Run 128/1,024 bounded characterization and EQP assertions.
12. Run focused, adjacent, full, static, registry/docs/diff and independent
    hostile review gates. Scheduled 10K/100K and crash/replay remain separate.

## 12. Required gates

Focused:

- A1 cursor invariants and ownership;
- B0a source fence;
- B0b/B1 cursor stage ownership;
- new cursor campaign and lifecycle suites.

Adjacent:

- source/stage/cooperation/handoff;
- stream/record, checkpoint, lease/lock/hold and legacy campaigns;
- SQLite provider cursor behavior and semantic integrity.

Final Python gates:

- full canonical `uv run pytest`;
- scoped and full Ruff check;
- scoped Ruff format check without rewriting another lane;
- strict MyPy;
- `git diff --check` scoped and full;
- package-root non-export assertion;
- SQLite migration/reconciliation contract and exact 54-rule registry check;
- normalized SQL/EQP hashes and literal fixture parity with TypeScript;
- independent review at HIGH 0 / MEDIUM 0 / LOW 0.

Fast bounded evidence records exact source/TEMP/seal/rule counts, root, maximum
live source rows, maximum live decoded snapshots, fetch counts, TEMP object
count and all EQPs for 128 and 1,024 cursors. It statically rejects `fetchall`,
proportional tuple/list capture and application sorting.

## 13. Explicit nonclaims

B2 does not:

- execute or modify migration `0002`;
- update descriptor or schema identity in a real cursor row;
- perform a permanent write, commit or rollback;
- issue a new A2b receipt;
- run `BLR_CURSOR_REBIND_COUNT` or `BLR_CURSOR_SEAL_MISMATCH`;
- reach `cursor/clock-complete`;
- persist an immutable root or v2 baseline;
- change any registry `implementationClaim`, protocol claim, release gate or
  throughput claim;
- prove 10K/100K RSS/latency, subprocess crash/replay or real asynchronous
  SQLite interruption;
- expose a public cursor-campaign API, diagnostic row identity or raw payload;
- establish release readiness, adoption, popularity or any star count.

The only truthful B2 success is: the exact live pre-rebind owner streamed the
real v1 cursor rows, produced a clean ten-rule vector, reproduced the retained
A1 count/root with the existing accumulator, re-proved all A2b/B0b/B1
authority, stored the exact input receipt and entered private
`pre-rebind-complete`. Any diagnostics yield only `diagnosed`; any owner or
resource failure yields a poisoned stage and caller-owned rollback.
