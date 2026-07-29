# SQLite cursor publication and rebind contract v2

Status: contract frozen; implementation, release, active-manifest, protocol and
production-throughput claims are all false.

This document closes the authority and ordering ambiguity between Cursor Slice
B2 and SQLite migration `0002`. The normative literal is
`conformance/sqlite-cursor-publication-rebind-v2.case.json`; its schema,
validator and hostile tests are executable contract gates.

## Boundary

`SQLITE-CURSOR-B3-PUBLICATION-REBIND` is a cursor subprotocol inside the full
v1-to-v2 atomic migration. It is not an independently committable migration,
does not own `BEGIN`, `COMMIT`, `ROLLBACK`, migration `0002`, baseline
publication, lineage publication or metadata publication, and cannot create an
accepted permanent intermediate state. The outer migration orchestrator owns
one `BEGIN EXCLUSIVE` generation and exactly one successful commit.

The complete order is source-v1 audit, clean B2 receipt, outer publication
authority, `0002`, adoption of a post-DDL catalog fence, baseline entries,
final baseline header, sequence zero, an adopted post-DDL stage authority, a
derived cursor publication session, one cursor rebind, rules 11 and 12,
cursor/clock completion, lineage, v2 metadata, publication rules, fresh-v2
catalog equality, physical and semantic postconditions, TEMP stage retirement,
a final lock/transaction fence, then commit. Any pre-commit failure must
roll the database back to exact source v1. Once commit returns, reopening must
observe complete target v2. No state between those two outcomes is accepted.

## Final identities

The source descriptor is
`4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe`
and the source schema identity is
`f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4`.

The target descriptor is independently derived by TypeScript and Python from
the current SQLite provider profile with schema and all reader/writer versions
set to 2. Its domain-separated identity is
`f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92`.
The raw canonical descriptor body hash is
`7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214`;
the complete canonical descriptor hash, including `descriptorHash`, is
`27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9`.
The target schema identity is
`9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634`.

These are frozen contract targets, not evidence that either runtime currently
opens v2. The preview manifest remains preview-only until runtime assets,
fresh-v2, v0-to-v1-to-v2, v1-to-v2, reopen, cross-language and package artifact
gates pass.

## Authority handoff

B3 uses two capabilities rather than pretending a pre-DDL object can commit to
a fence that does not exist yet. A module-minted outer publication authority
binds the exact B2 object graph, live transaction, migration-lock capability,
expected target catalog and the outer migration write ledger. It authorizes
`0002` and the baseline writes but explicitly does not authorize cursor
rebind.

After `0002`, the owner captures and validates a new post-DDL catalog fence.
It then consumes module-minted receipts for the exact `0002`, baseline-entry,
baseline-header and sequence-zero writes. A package-private intrinsic validates
their statement identities, affected counts and aggregate `total_changes`,
retires the old v1 catalog/change fence and adopts the stage into the same
`BEGIN EXCLUSIVE` lineage. Internal epoch values may advance differently in the
two runtimes and are never compared across runtimes; only the bridge may adopt
them. Caller-constructed receipts are forbidden.

Only after that adoption may the owner derive the one-shot cursor publication
session from the outer authority. That session binds the opaque pre-rebind receipt, projection
reference, stage transfer, baseline TEMP stage, SQLite connection, exact
transaction generation, observed post-DDL fence, source and target identities,
stage-adoption receipt, the opaque migration-lock capability and the exact
provider-clock capability. The active lock's ID, owner, epoch, fencing token
and expiry are committed. The clock capability must mint four distinct opaque,
single-use evidence receipts: before the first permanent mutation, before
rebind, before verification and before commit. Provider time must be monotonic
across those receipts, and every receipt is checked using
`freshProviderNowMs < committedActiveExpiresAtMs`; equality is expired. A
clock that advances past an unchanged expiry therefore fails the later fence,
and an earlier evidence receipt cannot be replayed. Structural equality is
insufficient; clones, reconstruction, serialization round trips, connection
substitution, rollback/rebegin and second use fail closed.

B2's v1 catalog fence cannot be reused after DDL. The cursor write ledger opens
only when the derived cursor session is minted and closes after rule 12; outer
`0002`, baseline, lineage and metadata writes remain owned by the separate outer
migration ledger and cannot be confused with the single cursor update.

## Permanent update and rule 11

The publication session owns one fixed statement:

```sql
UPDATE main.ge_cycle_cursors
SET descriptor_hash = ?, schema_identity_sha256 = ?
WHERE descriptor_hash = ? AND schema_identity_sha256 = ?
```

Parameters are target descriptor, target schema, source descriptor and source
schema, in that order. The statement is prepared by the module, executes once,
and its logical statement ownership is retired once. Python closes its cursor;
TypeScript releases its iterator/cursor ownership without claiming a native
`StatementSync.finalize()` API that does not exist. Caller SQL, triggers,
same-value replay, a second update
or any unexplained permanent write are forbidden.

Rule 11, `BLR_CURSOR_REBIND_COUNT`, compares the statement's affected row count
with the original B2 receipt's cursor count. The statement result, the
`total_changes` delta and the publication write-ledger delta must all agree.
Neither a fresh pre-update count nor the post-update seal count may substitute
for the receipt count.

## Rule 12

`BLR_CURSOR_SEAL_MISMATCH` never performs an unindexed token/tenant sort over
the main table. The existing owner-fenced B2 TEMP carrier supplies only the
ordered `(tenant_id, token_hash)` keys in token-hash UTF-8 byte order then
tenant-id UTF-8 byte order. Each key drives a fresh two-key primary-key point
lookup against `main.ge_cycle_cursors`; the returned 18-column main row, not the
TEMP carrier, supplies the post-update proof and seal carrier. A separate
main-primary-key key scan counts rows one at a time and detects extras without
an uninterruptible aggregate `count(*)`. Missing point lookups detect deletions.
Equal count plus one successful lookup per original key closes equal-count
replacement.

All three fixed queries require EQP evidence: the TEMP driver must use its
`(token_hash, tenant_id)` primary-key order without a sorter, the main key-count
scan must use `(tenant_id, token_hash)` primary-key order without a sorter, and
every main lookup must report the same main primary key. `AUTOMATIC`,
`MATERIALIZE`, `USE TEMP B-TREE` and `CO-ROUTINE` are forbidden. One-row
fetches, per-row cancellation and immediate release preserve the constant-live-
row and constant-live-carrier bound while reusing the accepted
`sqlite-cursor-seal/v1` domains and accumulator.

The sixteen immutable physical fields, including request and snapshot BLOB
lengths and SHA-256 digests, contribute to the same immutable root. The final
count and root must equal the exact B2 receipt. Every row's only two mutable
fields must equal the target descriptor and target schema identity. Partial
rebind, mixed identities, a third identity, insert/delete, equal-count
replacement and same-length BLOB substitution all fail.

Only exact rule 11 and 12 success transitions the same private stage session
from `publication-active` to `cursor/clock-complete`. That capability is a
prerequisite for later publication rules; it is not permission to commit.

Lineage and schema/descriptor metadata publication remain outer-authority
writes after `cursor/clock-complete`. A second package-private adoption bridge
therefore runs only after publication rules, fresh-v2 catalog equivalence and
physical/semantic postconditions have each minted their exact zero-write
receipt. It consumes those audit receipts and the two exact module-minted outer
write receipts. The bridge also verifies the exact `cursorClockCapability`
tombstone proving that capability already consumed the pre-verification clock
receipt; it never consumes that single-use receipt a second time. It then
reproves the same transaction, outer ledger, current catalog and current
private epoch and mints one `preRetirementStageFenceReceipt`. It does not mint a second initial
stage-adoption receipt, and epoch numbers are still runtime-private. Consuming
the two outer-write and three audit receipts mints five exact consumed-receipt
tombstones; the pre-retirement receipt commits both original identities and
those tombstones. After this receipt, permanent writes are forbidden.

The retirement intrinsic consumes the fence receipt exactly once. It requires
zero active count/driver/point cursors, binds each owned TEMP object by type,
name, table name, an unforgeable module-minted runtime generation nonce, the
guarded connection's TEMP-catalog mutation epoch, normalized SQL digest and
stage ownership generation. A SQLite root page is diagnostic only because it
may be reused after drop/recreate. Every TEMP DDL advances the guarded
connection mutation epoch; the retirement receipt requires that epoch to be
unchanged until retirement begins. Retirement then owns an authorized epoch
chain: each exact owned drop consumes the prior mutation-epoch receipt and
mints the next one. Any unaccounted TEMP DDL breaks the chain. The intrinsic
rechecks identity before every reverse-order drop,
preserves unrelated TEMP objects, proves zero owned-prefix residue and proves
the permanent ledgers plus `total_changes` did not move. Only then can it mint
a one-shot `stageRetirementReceipt`. The final migration lock/transaction fence
consumes that receipt and a fresh pre-commit clock receipt. The retirement
receipt transitively commits the already-consumed audit tombstones, so the
final fence does not consume those single-use audit receipts again. It reproves
the target catalog and zero TEMP residue and mints the one-shot receipt that
alone authorizes the single commit.

## Failure and crash semantics

Failure precedence is boundary-local. Receipt, exact object, outer authority,
lock, transaction and expected-catalog errors outrank cancellation before the
first permanent write. Once those checks pass, cancellation may stop before
`0002`. Before rebind, the derived session, fresh lock, transaction and post-DDL
fence outrank cancellation; after a statement or fetch starts, its primary
write-ledger, shape or rule failure outranks later cancellation, and cleanup is
last. After commit returns, the only valid interpretation is complete-v2 reopen
audit followed by cleanup, never a claimed rollback.

Rule failure poisons the owner and requires caller rollback; a diagnosed result
does not disclose a receipt or immutable root. Both rule failures use one
aggregate diagnostic unit. Rule 12 does not fabricate a cursor-row identity
when count/root drift, deletion or equal-count replacement cannot be localized.
The literal also freezes 20 cancellation labels, 16 prepare/execute/fetch/
ownership-retirement boundaries, seven cleanup failures and exact-once cursor/
statement ownership closure. Cancellation labels request cancellation; they are
not unconditional throw sites. Once a rebind or row operation starts, its
statement/row primary proof and immediate cursor close occur before cancellation
is observed. After the final row, accumulator finish and count/root/identity
comparison occur before cancellation; cleanup remains last.

For the separate main-key count scan, a started row is decoded, validated and
counted before cancellation is observed. On cancellation or failure its cursor
closes before TEMP/outer cleanup; on success it closes before the key-driver
statement is prepared. This prevents the count cursor from becoming a hidden
third live cursor during the seal stream.

At most two cursors are active during rule 12: one long-lived key driver and one
point cursor. The point cursor closes before the next driver fetch. Cleanup is
phase-specific: count phase closes the main-key-count cursor before TEMP/outer
cleanup, while seal phase closes point then driver before TEMP/outer cleanup.
The count cursor is already closed before the seal phase starts. After all
publication and physical/semantic audits succeed, exact TEMP retirement/drop is
a commit prerequisite. A cleanup-only retirement failure prevents commit; an
existing primary remains authoritative when retirement also fails. The final
migration-lock/transaction fence runs only after successful retirement.

Fault injection spans authority, `0002`, first/middle/last baseline entries,
header, sequence, rebind, both rules, lineage, metadata, publication rules,
pre-commit and commit-returned. Subprocess termination, BUSY/LOCKED, connection
loss, cleanup failure and fresh-authority retry are mandatory integration
tests. A retry never reuses the prior receipt, stage, session or transaction.

## Implementation order

1. Keep the shared literal immutable and make TypeScript and Python consume it.
2. Add a package-private publication-session and post-DDL catalog-fence bridge
   without any permanent mutation.
3. Vendor and validate v2 assets in both runtimes without switching the active
   manifest.
4. Implement the one-shot rebind and rules 11/12 behind private interfaces.
5. Integrate them into the full atomic v1-to-v2 orchestrator.
6. Run fault, cancellation, crash/reopen, cross-runtime and artifact parity.
7. Switch the active manifest only after every gate and an independent
   severity-zero review.

Until step 7, this contract must continue to report every implementation and
release claim as false.
