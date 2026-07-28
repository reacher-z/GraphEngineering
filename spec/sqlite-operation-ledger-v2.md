# SQLite operation-ledger version 2 canonical byte protocol

Status: frozen implementation contract for the active D7-S02 remediation.
This document fixes the choices that are intentionally not left to an
individual TypeScript or Python implementation. Passing the contract is not a
release-readiness or popularity claim.

## 1. Immutable predecessors

The following repository bytes are predecessors and MUST NOT change:

| Asset | SHA-256 |
| --- | --- |
| `schema-v1.sql` | `ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c` |
| `0001-alpha-v0-to-v1.sql` | `a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c` |
| `schema-v1.identity.json` | `4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682` |

Schema version 2 is a new immutable edge. It never reconstructs request bytes
for a version-1 operation.

## 2. Canonical encoding and bounds

Every key, state, request, result, and policy BLOB named canonical below is the
UTF-8 encoding of `canonicalSerialize(value)` from the shared core contract.
It has no BOM or trailing newline. Decoding MUST reject invalid UTF-8,
duplicate JSON object keys, non-portable numbers, excessive depth, unknown
fields, and any byte sequence whose decode/re-encode result differs.

The storage bounds are:

- request BLOB: 2 through 17,825,792 bytes;
- result BLOB: 2 through 16,777,216 bytes;
- baseline key BLOB: 2 through 4,096 bytes;
- baseline state BLOB: 2 through 2,097,152 bytes; and
- baseline policy BLOB: 2 through 1,048,576 bytes.

The request ceiling is `maxCheckpointBytes + maxRecordBytes`. Each operation's
closed request codec continues to apply its smaller semantic bound, including
the 8,388,608-byte append aggregate and the 64-record append limit.

## 3. Fixed hash domains and roots

Domain strings include the displayed terminal NUL byte:

```text
BASELINE_ID_DOMAIN = graph-engineering/sqlite-operation-baseline-id/v1\0
BASELINE_ENTRY_DOMAIN = graph-engineering/sqlite-operation-baseline-entry/v1\0
BASELINE_PROJECTION_DOMAIN = graph-engineering/sqlite-operation-baseline-projection/v1\0
BASELINE_GENESIS_DOMAIN = graph-engineering/sqlite-operation-baseline-genesis/v1\0
BASELINE_EMPTY_DOMAIN = graph-engineering/sqlite-operation-baseline-empty/v1\0
LEDGER_REPLAY_DIGEST_DOMAIN = graph-engineering/sqlite-operation-ledger-replay/v1\0
```

The fixed genesis predecessor is the SHA-256 of the UTF-8 genesis domain:

```text
5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96
```

The fixed empty root is the SHA-256 of the UTF-8 empty domain:

```text
66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a
```

`domainHash(domain, value)` is SHA-256 over the concatenation of the domain's
UTF-8 bytes and the canonical JSON UTF-8 bytes of `value`.

## 4. Source envelope and baseline ID

The migration freezes this exact source envelope before changing the catalog:

```json
{
  "capturedAtMs": 0,
  "sourceApplicationId": 1195724359,
  "sourceDescriptorHash": "<64 lowercase hex>",
  "sourceMigrationLineageId": "<closed identifier>",
  "sourceMigrationLineageSha256": "<64 lowercase hex>",
  "sourceSchemaIdentitySha256": "<64 lowercase hex>",
  "sourceUserVersion": 1
}
```

`capturedAtMs` above is illustrative; the actual safe integer is chosen once
inside the exclusive transaction. The baseline ID is:

```text
"v2-" + domainHash(BASELINE_ID_DOMAIN, sourceEnvelope)
```

It is therefore deterministic for the exact source identity and transaction
time and satisfies the closed SQLite identifier grammar.

A direct fresh-v2 bootstrap models an empty canonical v1 source with lineage
ID `fresh-v1-baseline`, lineage SHA equal to the frozen schema-v1 SQL SHA,
schema identity equal to the frozen v1 identity, and the frozen v1 SQLite
descriptor hash. It records one final migration row `(version=2,
previous_version=1, migration_id=fresh-v2-operation-replay)`; it does not
invent a version-1 migration row that never ran.

A v1 upgrade preserves its real source lineage in the baseline. A v0 upgrade
retains the version-1 migration row and appends the version-2 row in the same
exclusive transaction.

## 5. Baseline policy BLOB

The policy BLOB is the canonical encoding of exactly this closed object:

```json
{
  "baselineFormatVersion": 1,
  "canonicalEncoding": "graph-engineering/canonical-json/v1",
  "cursorReplay": "independent-semantic-audit",
  "emptyRoot": "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a",
  "entryHashDomain": "graph-engineering/sqlite-operation-baseline-entry/v1\u0000",
  "entryKinds": [
    "schema-envelope",
    "migration-lineage",
    "stream-head",
    "record-identity",
    "checkpoint-current",
    "checkpoint-revision",
    "lease-current",
    "used-lease-identity",
    "legal-hold",
    "migration-lock-current",
    "used-migration-lock-identity",
    "legacy-operation"
  ],
  "genesisHash": "5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96",
  "legacyRequestRecovery": false,
  "maxEntryKeyBytes": 4096,
  "maxEntryStateBytes": 2097152,
  "payloadOmissions": ["checkpoint-value", "record-blob", "record-value"],
  "projectionHashDomain": "graph-engineering/sqlite-operation-baseline-projection/v1\u0000",
  "replayStartsAtCommitSequence": 1,
  "sort": ["entry-kind-rank", "entry-key-utf8-bytes"]
}
```

No runtime field, timestamp, host name, path, secret, or provider payload is
added to this object.

## 6. Entry order, hash, and projection

The twelve `entryKinds` above define ranks zero through eleven. Within a kind,
entries sort by unsigned lexicographic comparison of canonical key UTF-8
bytes. Duplicate `(kind, key bytes)` is corruption. Ordinal starts at zero and
has no gaps.

For entry `i`, `previousEntryHash` is the fixed genesis predecessor when
`i = 0`, otherwise entry `i - 1`'s hash. Let `keyBytes` and `stateBytes` be the
exact stored BLOBs. The entry hash is:

```text
domainHash(BASELINE_ENTRY_DOMAIN, {
  baselineId,
  entryKeySha256: sha256(keyBytes),
  entryKind,
  entryStateSha256: sha256(stateBytes),
  ordinal,
  previousEntryHash
})
```

The projection SHA-256 is:

```text
domainHash(BASELINE_PROJECTION_DOMAIN, {
  baselineId,
  entryCount,
  finalEntryHash,
  firstEntryHash,
  legacyOperationCount
})
```

For zero entries, both first and final entry hashes equal the fixed empty root.
For nonzero entries, they equal the first and last stored entry hashes. The
header's creation runtime fields are evidence only and do not enter baseline
ID, entry hashes, or projection identity.

The deferred baseline-entry foreign key permits one bounded streaming pass:
entries may be inserted before their final header inside the same exclusive
transaction. The header and sequence row MUST exist before commit. A visible
placeholder header is forbidden.

## 7. Exact entry key and state shapes

All objects below are closed. Nullable SQL values are explicit JSON `null`;
they are never omitted. Integers are safe integers. Column payload BLOBs are
decoded only where the shape says a decoded object; otherwise only their
validated identity is retained.

### 7.1 schema-envelope

- key: `{ "scope": "cycle-store" }`
- state: `{ "createdAtMs", "currentVersion", "latestMigrationAppliedAtMs",
  "latestMigrationSha256", "maxReaderVersion", "maxWriterVersion",
  "minReaderVersion", "minWriterVersion", "providerDescriptorHash",
  "schemaIdentitySha256", "updatedAtMs" }`

The state is the validated source-v1 schema singleton before catalog mutation.

### 7.2 migration-lineage

- key: `{ "version" }`
- state: `{ "appliedAtMs", "migrationId", "postconditions",
  "previousVersion", "reversibility", "schemaIdentitySha256", "sqlSha256",
  "version" }`

`postconditions` is the decoded canonical source BLOB. There is one entry per
source migration row.

### 7.3 stream-head

- key: `{ "streamId", "tenantId" }`
- state: `{ "createdAtMs", "streamId", "tailRecordHash", "tailSequence",
  "tenantId", "updatedAtMs" }`

### 7.4 record-identity

- key: `{ "recordId", "tenantId" }`
- state: `{ "committedAtMs", "previousRecordHash", "recordHash", "recordId",
  "sequence", "streamId", "tenantId", "valueBytes", "valueHash" }`

The key makes tenant-wide record-ID uniqueness replayable. `value_blob` and
`record_blob` are omitted only after their canonical bytes and hashes pass the
independent source audit.

### 7.5 checkpoint-current

- key: `{ "checkpointId", "checkpointScope", "tenantId" }`
- state: `{ "boundRecordHash", "boundSequence", "checkpointId",
  "checkpointRevision", "checkpointScope", "committedAtMs", "createdAt",
  "streamId", "summary", "tenantId", "valueBytes", "valueHash" }`

`summary` is the decoded canonical summary BLOB. The value and full checkpoint
payload BLOBs remain only in the authoritative checkpoint table.

### 7.6 checkpoint-revision

- key: `{ "checkpointScope", "revision", "tenantId" }`
- state: `{ "action", "boundRecordHash", "boundSequence",
  "checkpointCreatedAt", "checkpointId", "checkpointScope", "recordedAtMs",
  "revision", "summary", "tenantId", "valueBytes",
  "valueHash" }`

Every nullable field is explicit. `summary` is decoded canonical JSON or null.

### 7.7 lease-current

- key: `{ "streamId", "tenantId" }`
- state: `{ "activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken",
  "activeHolderId", "activeLeaseEpoch", "activeLeaseId", "lastFencingToken",
  "lastLeaseEpoch", "streamId", "tenantId", "updatedAtMs" }`

### 7.8 used-lease-identity

- key: `{ "leaseId", "streamId", "tenantId" }`
- state: `{ "fencingToken", "firstUsedAtMs", "leaseEpoch", "leaseId",
  "streamId", "tenantId" }`

### 7.9 legal-hold

- key: `{ "holdId", "streamId", "tenantId" }`
- state: `{ "holdId", "placedAtMs", "streamId", "tenantId" }`

### 7.10 migration-lock-current

- key: `{ "singleton": 1 }`
- state: `{ "activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken",
  "activeLockEpoch", "activeLockId", "activeOwnerId", "activeSourceVersion",
  "activeTargetVersion", "lastFencingToken", "lastLockEpoch", "singleton",
  "updatedAtMs" }`

### 7.11 used-migration-lock-identity

- key: `{ "lockId" }`
- state: `{ "fencingToken", "firstUsedAtMs", "lockEpoch", "lockId" }`

### 7.12 legacy-operation

- key: `{ "operationId", "tenantId" }`
- state: `{ "committedAtMs", "operationId", "operationName", "requestHash",
  "resultBlobSha256", "resultHash", "tenantId" }`

The exact legacy result BLOB remains in `ge_cycle_operations` and is decoded,
re-encoded, and hashed during every audit. Request bytes are unknown.

## 8. Operation row and sequence behavior

Version-1 rows are converted only to `(ledger_format_version=1,
request_blob=NULL, commit_sequence=NULL)`. A legacy exact retry is a
compatibility decision based on the retained operation name and
domain-separated request hash. It may return the retained canonical result,
but no API, report, or document may claim the legacy request bytes were
recovered or byte-compared.

Every new successful mutation stores format 2, its exact canonical request
bytes, and one global sequence. Allocation uses an exact singleton compare and
swap in the same transaction after mutation decisions and before ledger
insert. It never uses row ID, timestamp, tenant order, or `max(sequence)`.
Retry, rollback, failed decisions, and pre-commit death consume no sequence.

The first sequence is 1. If N format-2 rows exist, count, distinct count,
maximum sequence, and singleton high-water all equal N and minimum sequence is
1. Timestamps are nondecreasing by sequence and not earlier than baseline
capture. Overflow above 9,007,199,254,740,991 fails before commit with
`GE_CYCLE_STORE_QUOTA_EXCEEDED`.

## 9. Cursor transition during migration

Cursors are not operation-ledger entries. Before catalog mutation the source
cursor audit MUST validate every request/snapshot BLOB, immutable event tail,
scope, and expiry field. During the same exclusive transaction, only
`descriptor_hash` and `schema_identity_sha256` are rebound to the final v2
identities. Token hashes, principals, authorization hashes, scope bytes,
snapshot bytes, positions, and times remain byte-for-byte unchanged. The full
v2 cursor audit runs before commit and again on reopen.

Deleting cursors, silently expiring them, or rewriting their snapshot payload
is not a conforming migration.

## 10. Migration publication and audit

`0002-v1-to-v2-operation-replay.sql` performs only the manifest-bound catalog
rebuild and legacy row conversion. The runtime, under the same `BEGIN
EXCLUSIVE`, validates the source, streams baseline entries, inserts the final
header and sequence singleton, rebinds cursors, appends lineage, publishes v2
metadata, checks catalog equality with fresh v2, runs physical and semantic
postconditions, and commits once.

Any failure rolls back the table rebuild, baseline, sequence, cursors,
lineage, metadata, and user version together. An accepted v2 database has
exactly one baseline header, exactly one bound sequence singleton, no temporary
`*_v1` table, and a baseline/replay model that reconciles physical state in
both directions.
