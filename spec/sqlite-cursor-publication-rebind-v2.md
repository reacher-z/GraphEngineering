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

The authority graph contains exactly 34 opaque objects, and object identity is
part of the contract. They are the B2 pre-rebind receipt, projection reference,
stage ownership transfer and baseline TEMP stage; the SQLite connection;
migration-lock and provider-clock capabilities; outer, pre-rebind,
pre-verification and pre-commit clock evidence; the outer publication
authority and its outer-clock consumed tombstone; the post-DDL catalog fence
and publication reader lease; four initial-write receipts and their four
consumed tombstones; the stage-adoption receipt; the publication session and
cursor-clock capability; lineage and schema/descriptor publication receipts;
publication-rules, fresh-v2-catalog and physical/semantic-postcondition
receipts; and the pre-retirement, retirement and final-commit fence receipts.
A clone, reconstructed value, serialized round trip or object from another run
cannot stand in for any member of this graph even when every visible field is
equal.

Minting the outer authority has an explicit atomic boundary. The intrinsic
first validates the complete object graph and registers an inactive authority;
it has not consumed the outer clock receipt at this point. A presentation
failure or cancellation before the atomic tail consumes nothing, and the same
exact evidence may be presented again. The non-interruptible tail then, in
order, consumes the outer clock evidence once, mints its consumed tombstone,
publishes the B2 transfer's prepared state and activates the authority. Fault
injection is forbidden after that tail begins. An invariant failure in the
tail poisons the graph and requires rollback plus a fresh graph; it is never
reported as a retryable unused authority. The active authority is minted once,
is non-transferable, may be reused only inside its exact authority graph, is
not consumed by a write or adoption, and is retired by commit-returned,
rollback, poison or disposal.

## Initial publication writes

The first outer-authority write is one logical execution of the exact repository
asset `spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql`, whose SHA-256 is
`1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d`.
The asset is exactly 20 fixed SQLite statements. The logical asset execution
count is one even when an adapter exposes those statements through multiple
calls; adapter API-call counts are deliberately excluded from cross-runtime
parity. The runtime must retain ownership of the existing `BEGIN EXCLUSIVE`.
In particular, Python must not use `sqlite3.Connection.executescript()` for
this asset because that API can implicitly commit a pending transaction. It
must execute the validated 20-statement asset through an implementation that
does not issue, replace or commit the outer transaction. Partial execution or
a second logical execution poisons the migration.

Four opaque, module-minted, single-use receipts form the initial publication
chain, in this exact order:

1. `migration-0002-catalog-rebuild-receipt`, whose predecessor is the outer
   publication authority;
2. `baseline-entries-publication-receipt`, whose predecessors are the `0002`
   receipt and post-DDL catalog fence;
3. `baseline-header-publication-receipt`, whose predecessor is the entries
   receipt; and
4. `operation-sequence-zero-publication-receipt`, whose predecessor is the
   header receipt.

Every receipt binds its write kind, fixed SQL or repository-asset bytes and
SHA-256, canonical parameter and result digests, exact predecessor object,
connection, unchanged transaction lineage, outer authority, prepare/execute
counts, affected rows, `total_changes` before/after/delta and all three outer
ledger dimensions. Those dimensions are: logical-write sequence,
fixed-statement execution count and affected-row watermark. The exact deltas
are:

| Receipt | Logical-write delta | Fixed-statement delta | Affected rows and `total_changes` delta |
| --- | ---: | ---: | ---: |
| `0002` catalog rebuild | 1 | 20 | `1 + projection.legacyOperationCount` |
| baseline entries | 1 | `projection.entryCount` | `projection.entryCount` |
| baseline header | 1 | 1 | 1 |
| operation sequence zero | 1 | 1 | 1 |

The `0002` receipt additionally binds exact repository bytes, preview-manifest
identities, one schema-copy row, the legacy-operation copy count, application
and user versions, and pre/post physical catalog digests. The entries writer
prepares exactly once and executes its fixed insert once per projection entry.
Its ordered source read is:

```sql
SELECT kind_rank, entry_kind, key_blob, state_blob
FROM temp.ge_blr_stage
ORDER BY kind_rank ASC, key_blob ASC
```

The source-read SHA-256 is
`adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f`;
the fixed seven-parameter entry-insert SHA-256 is
`b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b`,
with parameters `baselineId`, `ordinal`, `entryKind`, `entryKeyBlob`,
`entryStateBlob`, `previousEntryHash`, `entryHash`. The stream must rederive
the exact ordinal and hash chain, first hash and final projection root.

The header insert SHA-256 is
`b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a`.
It executes exactly once and binds the baseline and projection identities,
entry and legacy-operation counts, first/final hashes, policy bytes and stable
runtime identity. Those identities are
`graph-engineering-typescript@0.1.0-alpha.1` and
`graph-engineering-python@0.1.0a1`; caller labels and ambient interpreter
versions are forbidden. The sequence-zero insert SHA-256 is
`a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85`.
It executes exactly once with `baselineId`, B2's `baselineCapturedAtMs` and a
provider-authoritative `updatedAtMs`, and it writes `last_commit_sequence = 0`.

Parameter and result identities use a single cross-runtime codec. Parameters
hash SHA-256 over the UTF-8 domain
`graph-engineering/sqlite-initial-write-parameters/v1\0` followed by canonical
JSON under `graph-engineering/canonical-json/v1alpha1-unicode-code-point-key-order`
for an execution-order array whose elements are parameter-order arrays of
tagged scalars. Even one execution retains both array levels; one execution
with no parameters is therefore `[[]]`, while no executions is `[]`. The
domain bytes are concatenated
directly with the canonical UTF-8 JSON bytes with no delimiter. Text is exactly
`{"type":"text","value":"…"}` and preserves Unicode scalar values without
normalization; integers use `{"type":"integer","value":"…"}` with canonical
decimal and negative zero forbidden; BLOBs use
`{"type":"blob","value":"…"}` with unpadded RFC 4648 section 5 base64url;
null is exactly `{"type":"null"}`. Results use the UTF-8 domain
`graph-engineering/sqlite-initial-write-result/v1\0` followed by canonical JSON
with the sole shape `{"affectedRows":"…"}`. The value is the complete logical
receipt's aggregate affected-row count as a non-negative canonical decimal
string, not a per-execution result array.
`lastInsertRowid` is not part of the result digest.

Seven golden vectors prevent the runtimes from agreeing on the same wrong
codec. Parameter `[[]]` hashes to
`8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a`;
one mixed text/integer/BLOB/null execution hashes to
`8fcf64e97e9fda027b287997e43efc5226b596207dfc56ed161e46859027c271`;
and the frozen two-execution vector hashes to
`379049937f6797daade28d4b963dcc865f51afa5fa3422b90f4e505deaad838e`.
The signed 64-bit minimum and maximum integer vectors hash to
`d3d9b55872b8b14e2ec8a3c2b5ca27db179993b97ce9e47845efd2923eef4460`
and
`be263941652b27aa8254e518d3de8853c3071e7b7310449a7af13fb8bd2765ce`.
Integer lexemes must match `^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$` and fall in
`[-9223372036854775808, 9223372036854775807]`; leading plus/zero, whitespace,
negative zero and out-of-range values fail before hashing.
Results `{"affectedRows":"0"}` and `{"affectedRows":"3"}` hash to
`7d4e42c580be36f078371942187c0bdf048da4ffa35556c3f219f5930c5abd62`
and
`9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417`
respectively after their result-domain prefix.

After `0002`, the owner captures and validates a new post-DDL catalog fence.
It then consumes module-minted receipts for the exact `0002`, baseline-entry,
baseline-header and sequence-zero writes. A package-private intrinsic validates
their statement identities, affected counts and aggregate `total_changes`,
retires the old v1 catalog/change fence and adopts the stage into the same
`BEGIN EXCLUSIVE` lineage. Internal epoch values may advance differently in the
two runtimes and are never compared across runtimes; only the bridge may adopt
them. Caller-constructed receipts are forbidden. The bridge validates the
entire four-receipt bundle before consuming anything; a missing, reordered,
cloned or substituted bundle consumes zero receipts and the same exact valid
bundle may be retried. Success consumes all four exactly once and mints four
consumed-receipt tombstones together with the one-shot stage-adoption receipt.

The post-DDL fence is an independently minted, reusable proof inside this exact
authority graph, not the B2 v1 fence and not a final semantic-v2 proof. It is
minted after `0002` and before baseline DML and binds the connection, unchanged
transaction lineage, outer authority, exact `0002` receipt, runtime-private
epoch, `total_changes` and outer-ledger watermarks, canonical `sqlite_schema`
digest, application/user versions and complete expected target physical
catalog inventory. It consumes no write receipt. Catalog drift after mint is a
hard failure.

Baseline entry publication receives a separate post-DDL reader lease. The
opaque, module-minted lease permits only the fixed ordered TEMP select above,
has no permanent-write or adoption authority, and may have at most one live
reader. Its cursor closes exactly once, including before cleanup after
cancellation. The read must independently rederive the ordinal and entry-hash
chain equal to the exact B2 projection; only read-proof watermarks may be
adopted. The lease cannot mint a stage-adoption receipt, and adoption is
forbidden while its reader is active. Its state is exactly `minted-unused`,
`reader-active`, `reader-closed`, `retired` or `poisoned`. Prepare/execute
failure before cursor ownership requires zero closes; after ownership starts,
success, cancellation and primary failure each require one close attempt.
Successful close retires the one-shot lease, while close failure poisons the
graph and requires rollback. Row decode/hash proof remains primary, close
failure follows it, cancellation follows the required close attempt, and outer
cleanup is last. The terminal retired/closed proof is not ambient state: its
opaque identity and exact close evidence are committed by the baseline-entry
publication receipt, presented by the adoption bundle and copied into the
stage-adoption receipt. Adoption rejects a missing, active, substituted,
replayed or failed-close terminal proof before receipt consumption.

Initial stage adoption validates the complete ordered four-receipt bundle and
all predecessor, authority, transaction, fence, `total_changes` and three-
dimensional ledger commitments before it consumes any receipt. Missing,
reordered, duplicate, cloned, substituted or cross-run receipts consume zero.
A presentation failure may retry only with a corrected complete bundle; a
cancellation before atomic consumption likewise leaves the exact valid bundle
retryable. After consumption begins, fault injection is forbidden. The
non-interruptible adoption consumes all four receipts, mints their four exact
tombstones, updates the stage watermarks, retires only B2's old v1
catalog/change fence, preserves the post-DDL fence and mints one stage-adoption
receipt. Authority, lineage, lock, catalog or ledger corruption poisons the
owner and requires rollback rather than retry.

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
The literal also freezes 25 cancellation labels, 19 prepare/execute/fetch/
ownership-retirement boundaries, eight cleanup failures and exact-once cursor/
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
tests. A rollback-level migration retry never reuses the prior receipt, stage,
session or transaction; this does not prohibit the explicitly frozen
pre-atomic-tail retries that consume no receipt and keep the transaction live.

The literal freezes exactly 145 unique hostile obligations. In addition to the
cursor and retirement attacks, they cover outer-authority clone, substitution,
cross-run replay, use after retirement and accidental write consumption;
outer-clock atomic-mint failures; exact `0002` byte/hash drift, partial or
second execution and disagreement among affected rows, `total_changes` and all
three ledger dimensions; parameter/result digest domain, scalar-type and
aggregation drift; early, cloned, substituted, replayed or drifted
post-DDL fences; reader-lease clone, substitution, replay, SQL/order/projection
drift and leaked or failed-close readers; missing, reordered, duplicate,
cloned, substituted, cross-run or wrong-predecessor initial receipts; baseline
partial writes and caller-controlled runtime identity or timestamps; and
stage-adoption cancellation, replay and forbidden injection inside the atomic
consume tail; malformed four-write parity arrays; exact catalog-query and
inventory drift; and missing reader-terminal proof. Each obligation has one
ordered execution record containing its injection hook, mutation, stable error
code, counter profile and semantic outcome. The ordered registry is locked by
SHA-256
`4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`;
the fully expanded expectations are independently locked by SHA-256
`6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`.
Both runtimes must execute all 145 records with no skip, not merely report a
matching count or copy expected output.

Each record names its phase, exact child failure boundary, parent precedence
bucket and retry-evidence mode. Its semantic fields combine with one of 25
fully specified 20-counter profiles to produce the complete ordered 28-field
output. Invalid presentations allow only a corrected complete bundle; a valid
bundle cancelled before the atomic tail permits the same exact valid bundle;
post-mutation poison requires rollback and a fresh authority graph. The
execution requirement is normative, while runtime execution evidence remains
explicitly unclaimed until both native campaigns exist.

The post-DDL fence reads every explicitly declared object in the owned
`ge_cycle_*` namespace using the exact ordered `sqlite_schema` query frozen in
the fixture. Its predicate is `lower(name) GLOB 'ge_cycle_*'`: SQLite treats
ASCII identifier case as insignificant, so a case-sensitive name predicate
would otherwise miss hostile uppercase or mixed-case objects. It intentionally
does not filter object type, so an injected view or trigger cannot hide from
the fence. The 34-row, 5,785-byte canonical
inventory is domain-separated by
`graph-engineering/sqlite-target-physical-catalog/v1\0` and has SHA-256
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
The query itself has SHA-256
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
`rootpage` is excluded because it is allocator state rather than schema
identity; exact `type`, `name`, `tableName` and SQL-text hashes remain included.

The complete fixture is hashed as SHA-256 over the UTF-8 domain
`graph-engineering/sqlite-cursor-publication-rebind-v2-fixture/v1\0` followed
immediately by canonical JSON after replacing only
`parityGates.fixtureCanonicalSha256` with 64 lowercase zeroes. Its accepted
digest is
`32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993`.
The schema retains reusable shape definitions and also references a recursively
exact frozen-instance tree: object keys are required and closed, arrays use
exact `prefixItems`, and all 4,959 primitive leaves are constants. This avoids
object-`const` incompatibility with the duplicate-safe null-prototype parser
while making schema-only mutation, reordering and extension fail closed.

## Initial-publication parity record

Initial-publication conformance emits one normalized record with exactly these
28 ordered fields:

1. `caseId`
2. `outcome`
3. `failureBoundary`
4. `state`
5. `poisoned`
6. `providerClockReadCount`
7. `clockEvidenceConsumeCount`
8. `outerAuthorityMintCount`
9. `perWritePrepareCounts`
10. `perWriteExecuteCounts`
11. `perWriteAffectedRowCounts`
12. `perWriteTotalChangesDeltas`
13. `outerLedgerLogicalWriteSequence`
14. `outerLedgerFixedStatementCount`
15. `outerLedgerAffectedRowsWatermark`
16. `postDdlCatalogFenceMintCount`
17. `readerLeaseMintCount`
18. `readerLeaseCloseCount`
19. `initialWriteReceiptMintCount`
20. `initialWriteReceiptConsumeCount`
21. `initialWriteReceiptTombstoneCount`
22. `stageAdoptionReceiptMintCount`
23. `bundleRetryable`
24. `sameTransactionLineage`
25. `catalogFenceMatches`
26. `cursorRebindPrepareCount`
27. `cursorRebindExecuteCount`
28. `commitCount`

The counters must come from real hooks. A self-probe must first demonstrate
one provider-clock read, one clock-evidence consumption and one outer-authority
mint so an unwired all-zero implementation cannot pass. Opaque addresses,
runtime-private epoch values and adapter API-call counts are excluded from
cross-runtime comparison. Every initial-publication case that stops before
rebind must report zero cursor-rebind prepares, zero cursor-rebind executes and
zero commits.

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
