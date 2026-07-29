# SQLite Cursor Slice B B2 cross-runtime conformance contract

Date: 2026-07-28
Status: implementation-ready design; no implementation or completion claim
Scope: B2 production-row capture, rules 1-10, diagnostics, A1 reproduction,
TypeScript/Python parity and shared-fixture gates only

## 1. Decision and authority

B2 starts from the accepted exact B0b transfer and B1-owned
`temp.ge_blr_cursor_seal`. It scans the exact captured v1 database, stages one
bounded carrier per cursor, executes rules 1-10 in registry order, and has two
terminal outcomes: `pre-rebind-complete` or `diagnosed`.

Authority is resolved as follows.

1. Master-plan §31.34.45 supersedes §31.34.44 only for the physical column
   count, seal order and two-phase completion wording.
2. The physical row has 18 columns: 16 immutable seal fields and the separately
   checked mutable `descriptor_hash` and `schema_identity_sha256`.
3. Canonical seal order is token-hash unsigned UTF-8 bytes, then tenant-id
   unsigned UTF-8 bytes. The main source remains tenant then token PK order.
4. Rules 1-10 are B2. Rules 11/12, rebind, publication and
   `cursor/clock-complete` are later work.
5. §31.34.18 and the accepted Slice-B design intentionally keep the registry
   `implementationClaim`, `releaseGate`, `productionThroughputClaim` and
   `cursorSeal.protocolClaim` false. Its deferred empty-root label is a
   conservative whole-protocol publication gate, not uncertainty about the
   accepted private A1 root. B2 MUST NOT change it.
6. The accepted checkpoint order is `bound_sequence DESC, created_at DESC,
   checkpoint_id ASC`; shorthand “descending ID” is rejected.

No unresolved plan contradiction blocks implementation.

## 2. Proposed shared artifact

The main/spec lane shall add one literal file only after this design is
accepted:

`spec/conformance/sqlite-cursor-pre-rebind-v1.case.json`

Its JSON object is closed and has these keys in this order:

1. `schemaVersion` = 1;
2. `id` = `sqlite-cursor-pre-rebind-v1`;
3. `status` = `contract-frozen`;
4. `claims`;
5. `resourceLimits`;
6. `ruleOrder`;
7. `carrierContract`;
8. `sqlContract`;
9. `eqpContract`;
10. `outcomeContract`;
11. `pristineCases`;
12. `hostileCases`;
13. `lifecycleCases`;
14. `parityGates`.

The corresponding closed schema is
`spec/conformance/sqlite-cursor-pre-rebind-v1.schema.json`; validator and test
are `.validate.mjs` and `.test.mjs`. Duplicate JSON keys, unknown fields,
wrong order where order is normative, non-literal computed expectations and
any true release/protocol claim fail validation.

`claims` is exactly:

```json
{
  "implementationClaim": false,
  "protocolClaim": false,
  "releaseGate": false,
  "productionThroughputClaim": false,
  "terminalState": "pre-rebind-complete"
}
```

## 3. Frozen limits and memory contract

`resourceLimits` freezes:

- diagnostic default 16, minimum 1, maximum 64;
- source fetch size 1 and seal fetch size 1;
- page size inclusive range 1..256;
- safe integer maximum 9,007,199,254,740,991;
- request-scope bytes 2..1,048,576;
- snapshot bytes 2..16,777,216;
- one active campaign cursor at a time;
- one current physical row, one current carrier and at most one decoded
  checkpoint snapshot at a time;
- marker fetch bound `diagnosticLimit + 1` (therefore at most 65);
- no `.all()`, `fetchall()`, proportional list/tuple/map, application sort,
  decoded-snapshot retention or raw-BLOB retention.

The raw BLOB must be length-bounded before UTF-8/JSON work, duplicate keys and
nonportable constants rejected, exact canonical bytes re-derived, length and
lowercase SHA-256 retained, and raw/decoded content released before the next
source fetch. Diagnostics never expose tenant, token, hashes, SQL values,
snapshots or payload fragments.

## 4. A1 bytes are inherited, not reimplemented

B2 reconstructs the accepted A1 carrier directly from the TEMP projection and
calls the existing accumulator. It does not invent a second serializer or
seal.

- row domain: `graph-engineering/sqlite-cursor-seal-row/v1\0`;
- seal domain: `graph-engineering/sqlite-cursor-seal/v1\0`;
- row digest: `SHA256(rowDomain || u64be(length) || canonicalCarrierBytes)`;
- genesis: `SHA256(sealDomain || 0x00)`;
- step N: `SHA256(sealDomain || 0x01 || prior || u64be(N) || rowDigest)`;
- terminal: `SHA256(sealDomain || 0x02 || u64be(count) || state)`.

Carrier keys remain the accepted 18-key canonical order. Mutable identities
are validated beside the carrier and excluded from the root. Literal roots
retained by the fixture are:

- empty: `587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f`;
- event: `1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea`;
- checkpoint: `4fefb119ba4e71217c64470627ce9b07388ffdd29cf0b3549b7127b06436f5f6`;
- cross-order pair: `3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1`.

## 5. Exact SQL and hashes

Hashing is lowercase SHA-256 of whitespace-normalized SQL: trim and replace
every nonempty whitespace run with one ASCII space. Both runtimes export the
same normalized bytes and compare them to fixture literals.

### 5.1 Source

The existing exact 18-column source projection is retained, ordered by
`tenant_id COLLATE BINARY, token_hash COLLATE BINARY`. Its normalized hash is:

`dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4`.

No `LIMIT/OFFSET` pagination is allowed on this one-pass walker. Its bound is
the one-row fetch API, not an unbounded native collection.

### 5.2 Insert

The exact 30-column insert follows B1 xinfo order, uses thirty positional `?`
parameters and no `RETURNING`. Its normalized hash is:

`fbcf5255335c392f4f18818d8f12e79abbcfc677f768579fbe05f317a7a4774b`.

Every execute must report exactly one statement change and advance the
stage-owned allowed `total_changes` by exactly one. Prepare, bind, execute,
counter proof and reset/close are fenced for every row.

### 5.3 Seal projection

The exact 20-column projection is the carrier/identity columns in this order:
tenant, token, kind, principal, authorization, stream, scope, request length,
request digest, page, next position, tail sequence, tail hash, snapshot length,
snapshot digest, created, expires, consumed, descriptor, schema. It reads
`WHERE seal_eligible = 1` and orders token then tenant with BINARY collation.
Normalized hash:

`c169d8478a327605640a031bc1129d699341165bc6f59bdf7151c3e33677458e`.

It is executed only for an all-zero diagnostic vector. A diagnosed outcome
has no best-effort root or receipt.

### 5.4 Marker projections

Each row-rule query is exactly:

```sql
SELECT 1 AS violation_marker
FROM temp.ge_blr_cursor_seal
WHERE <flag> = 0
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY
LIMIT ?
```

The sole binding is `diagnosticLimit + 1`. Exact flag/hash pairs are:

| rule | flag | normalized SHA-256 |
|---|---|---|
| 1 | `authorization_ok` | `4b05dede61e9303c06a459416e8d6da4eac6007dedbab602ae4f4b942e9fbebf` |
| 2 | `scope_ok` | `9bf6d38c051294f87798839738e5f913c69a54e8ac81dd571e36eda33ea8b628` |
| 3 | `blobs_canonical_ok` | `64b77f510a88d3091603b5d9c93d58a5eb69d65c20f67c081847654434e514b8` |
| 4 | `position_ok` | `aa3a0bbb0a07137a0e497c9140d359608358b5fd3bf1ac7e1ed15a34893678b3` |
| 5 | `clock_ok` | `494b6ae97f33349cfb787afedc3bbf2ee69021a669abb4dd14273028d2117771` |
| 6 | `catalog_ok` | `6dec1fa0dc5aa8b48c9fa45c50ed2dba32cb2a01c83f934407484c1200460562` |
| 8 | `shape_ok` | `2600c8112c8e55f814a0f57ea50b822eb14c91e13871bec99965e7aa6a91c8cd` |
| 9 | `event_binding_ok` | `515c1832cfc0238339a838245b7afabc83ca319e7f74fdeabbad6904152e3909` |
| 10 | `checkpoint_binding_ok` | `92315896aa7d1f1acab782dad89641687da88350f5843f9c34d32026f6a9c8ce` |

Rule 7 is one inventory unit, not one unit per row. Its exact constant query is
`SELECT 1 AS violation_marker WHERE ? <> ? OR ? <> ? LIMIT ?`, binding
captured-main vs walked-source count, then walked-source vs TEMP count, then
`diagnosticLimit + 1`. Hash:
`d4fa6279ee8d237b0ec82d9aed1b70e804d45890dd6d02313ac9ffea6260c830`.

Seal eligibility is deliberately not a rule-7 count. A malformed row is
already owned by its field rule(s); rule 7 owns inventory loss/duplication.
Equal-count replacement after A2b is detected by final A1 count/root mismatch
and is a terminal stale-authority failure, not falsely relabeled rule 7 or the
future rule 12.

## 6. EQP contract

Each supported SQLite version fixture stores normalized detail lines, but the
portable acceptance predicate is authoritative:

- source: scan `main.ge_cycle_cursors` in its PK order; no TEMP B-tree;
- insert: write only `temp.ge_blr_cursor_seal`;
- seal and row markers: scan the WITHOUT ROWID table in PK token/tenant order;
- rule 7: constant-row scan only;
- event history lookup: exact covering lookup on
  `ge_cycle_records_stream_sequence_hash_uq`;
- checkpoint history lookup: exact bounded lookup on
  `ge_cycle_checkpoint_revisions_lookup_idx` plus one-row iteration of the
  decoded snapshot; current checkpoint table is not consulted.

Reject any plan detail containing `AUTOMATIC`, `MATERIALIZE`, `USE TEMP
B-TREE`, `CO-ROUTINE`, an unbounded sorter, or an unexpected table/index.
Do not freeze or use a guessed `sqlite_autoindex_*` name for the WITHOUT ROWID
TEMP primary key. Every prepare/EQP cursor has the same register/fetch/close
discipline as a production cursor.

## 7. Ten-rule parity matrix

Rules are evaluated independently; one cursor may set several flags false,
but contributes at most once per rule.

1. `BLR_CURSOR_AUTHORIZATION`: lexical tenant/token/principal/authorization
   proof and immutable contribution. Token plaintext is unavailable. Valid
   64-hex substitution after A2b is caught by the final root fence.
2. `BLR_CURSOR_SCOPE`: exact event/checkpoint null group and decoded closed
   request object. Event object is contractVersion/streamId/pageSize;
   checkpoint is contractVersion/checkpointScope/pageSize. No extra key.
3. `BLR_CURSOR_BLOB_CANONICAL`: both bounds, fatal UTF-8, no BOM, JSON duplicate
   rejection, no NaN/Infinity, portable snapshot, exact canonical re-encode.
4. `BLR_CURSOR_POSITION`: page 1..256; next 0..MAX_SAFE; empty event position
   zero; nonempty event next no later than the frozen tail sequence;
   checkpoint next no later than array length.
5. `BLR_CURSOR_EXPIRY_CONSUMPTION`: safe created/expires/consumed, expires
   strictly later, consumed absent or no earlier, created/consumed no later
   than frozen provider high-water, capture >= high-water >= noncursor max.
   Expiry, lease/lock expiry and RFC3339 checkpoint times are excluded from
   provider observation aggregation.
6. `BLR_CURSOR_CATALOG_BINDING`: row descriptor/schema exactly equal the A2b
   source identities. DDL/catalog replacement is terminal owner corruption,
   never a tenant row diagnostic.
7. `BLR_CURSOR_SEAL_COUNT`: exactly one unit if main/source/TEMP counts differ.
8. `BLR_CURSOR_SHAPE`: 18 arity, SQLite storage classes, nullability, safe
   lexical/scalar shape not semantically assigned above. No fatal A1 decoder
   shortcut may steal a diagnostic.
9. `BLR_CURSOR_EVENT_BINDING`: canonical event snapshot equals exact tail
   tuple; empty `(-1,null)` is allowed and needs no record; nonempty exact
   tenant/stream/sequence/hash retained record must exist. Later head/append is
   allowed.
10. `BLR_CURSOR_CHECKPOINT_BINDING`: array summaries decode through the real
    checkpoint codec, match same tenant/scope/id historical `put` summary
    bytes, and are strictly sequence DESC, createdAt DESC, checkpointId ASC.
    Later current mutation/delete is allowed.

Diagnostics are emitted only for nonzero rules, always in this order. Envelope
is exactly `{ruleId, violationCount, diagnosticsTruncated}`. Count is
`min(actual, limit)` and truncation iff actual exceeds limit. Fetched marker
must be exactly one column with integer value 1; malformed arity/type/value is
terminal campaign corruption, not a diagnostic.

## 8. Inspection and staging semantics

The B2 inspector must not call strict A1 decoding first. It returns a closed
result containing the 20 safe stage values, nine per-row rule booleans and an
optional seal-eligible A1 carrier. Invalid raw values are represented only by
fixed safe internal sentinels sufficient to insert the row and mark the owning
rules false; sentinels never contribute to a seal and never leave the module.
If a physical row cannot provide a unique bounded token/tenant stage key, the
campaign emits the relevant rule-1/rule-8 unit through a bounded pre-stage
counter and terminates diagnosed without pretending it was staged. This case
cannot be silently dropped or converted to null.

`seal_eligible` is one only when every A1 precondition and all nine per-row
flags are true. Rule 7 is global and excluded. Non-applicable event/checkpoint
flags are true. Stage all representable rows even when diagnosed, so later
independent rules remain observable.

## 9. Outcome and precedence

Clean outcome is a frozen/opaque exact-identity value containing the exact
input A2b receipt, exact projection identity, empty diagnostics and status
`pre-rebind-complete`. It is issued only after:

1. source close;
2. exact counts and all ten rule cursors close;
3. all-zero vector;
4. catalog, transaction epoch and allowed-change fences;
5. unchanged A2a clocks;
6. A1 stream count/root exactly equal retained A2b receipt;
7. exact source identities/projection/reference/session object graph;
8. a final non-consuming A2b fence.

Diagnosed outcome is frozen and contains status, exact projection identity,
safe diagnostics and literal ten-number vector; it contains no `receipt`,
root, seal candidate or null placeholder. It is terminal for this stage.

Failure precedence is: A2b authority; exact transfer/session; owner epoch and
EXCLUSIVE mode; catalog; statement/EQP/marker shape; cancellation; cleanup.
Primary failure survives cleanup failure. A diagnostic is data, not an
exception. Mutation after a real diagnostic or between rules upgrades the run
to terminal owner corruption and suppresses publication of the stale report.

## 10. Literal case corpus

`pristineCases` must contain at least: empty; one event empty tail; one event
nonempty tail; one checkpoint; event+checkpoint cross-order pair; same token
hash in two tenants; page 1; page 256; consumed; expired-but-locally-valid;
later event append; later current checkpoint mutation/delete. Every case pins
physical rows, related history, clocks, projection identity, exact count/root,
`[0,0,0,0,0,0,0,0,0,0]`, SQL hashes and outcome.

`hostileCases` must contain one isolated case per rule, then multi-rule and
authority cases: malformed auth; wrong null group; request extra/missing key;
bad UTF-8, BOM, duplicate key, whitespace/key order, overbound BLOB; pages
0/257; unsafe/negative/beyond-snapshot position; every clock boundary and
provider regression; descriptor and schema substitutions separately; source
insert/delete count differences; malformed storage class/null group; event
snapshot mismatch/missing tail/later retained tail; checkpoint missing put,
wrong tenant/scope/id/bytes and all three order inversions; same token across
tenant; equal-count insert/delete substitution; source DDL and index
replacement. Each pins exact ten-vector and outcome. Equal-count and DDL cases
pin terminal stale-authority/catalog outcomes, not invented diagnostics.

Limits have literal populations at 1, 2, 16, 17, 64 and 65 violations, proving
exact/plus-one behavior. The hostile aggregate has all ten nonzero entries and
proves registry order despite nonlexical fixture insertion order.

`lifecycleCases` includes each statement create, first/middle/final fetch and
close; decode-before-insert; insert 0/+2; post-row/pre-barrier; every rule
transition; malformed marker; post-diagnostic mutation; transaction end;
rollback/rebegin; active dispose; closed connection; cancellation at every
poll; cleanup-only and primary+cleanup; receipt/projection/transfer clone;
second run; abandonment; and begin before exact legacy completion.

## 11. Cross-runtime parity gates

TypeScript and Python must match, byte for byte or value for value:

- all normalized SQL and hashes;
- B1 DDL hash `032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a`;
- physical/stage/carrier projections and order;
- A1 canonical carrier bytes, row digests, count/root;
- source identities, projection and clocks;
- ten-number vectors, diagnostic order/count/truncation;
- outcome tags and semantic failure categories;
- fixture case names and EQP acceptance predicates;
- max simultaneously live row/snapshot/cursor counters.

Fast characterization is exactly 128 and 1,024 cursors with deliberately
conflicting tenant/token order. It is not a 10K/100K throughput claim. Both
focused suites, adjacent baseline suites, full SQLite/Python suites, TS
typecheck/lint/build, Ruff, strict MyPy, conformance validators, 54-rule
registry, docs links and diff checks must pass before acceptance.

## 12. Parallel implementation lanes

After the main agent lands the shared fixture/schema/validator, work can run
in parallel without overlapping ownership:

1. TypeScript lane: `packages/sqlite/src/operation-baseline-cursor-campaign.ts`,
   narrowly required private invariant/stage hooks, and focused/lifecycle
   tests. It must reuse B0b/B1 intrinsics and A1 accumulator.
2. Python lane: mirrored private campaign, inspector/stage hooks and tests
   under `python/`; exact types and captured unbound intrinsics remain required.
3. Main/spec lane: shared fixture/schema/validator, generated constant parity,
   registry nonclaim checks and integration gates. It alone changes `spec/`.
4. Independent audit lane: read-only attacks on authority order, SQL/EQP,
   boundedness, diagnostics, roots, clone resistance and cleanup precedence.

Merge order is fixture red gates, TS/Python independently green, cross-runtime
parity, full/static gates, then severity-zero audit. Runtime lanes must not edit
the shared fixture to make their own output pass.

## 13. Explicit nonclaims

B2 does not modify a permanent table/index, execute 0002, write v2 rows,
persist a seal, mutate descriptor/schema identities, rebind cursors, implement
rules 11/12 or publication rules, reach `cursor/clock-complete`, own commit or
rollback, prove asynchronous in-SQL interruption, prove 10K/100K performance,
prove crash/replay, expose public API/CLI, select a release, or establish stars,
adoption or popularity. Registry claim flags remain false.

Completion means only: exact B0b/B1 authority retained, production v1 cursors
boundedly checked by rules 1-10, accepted A1 root reproduced on clean data,
safe deterministic diagnostics on hostile data, and identical TS/Python
evidence at `pre-rebind-complete`.
