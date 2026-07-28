import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import { canonicalSerialize } from "../../packages/core/dist/index.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_BACKUP_MANIFEST_API_VERSION,
  SQLITE_BACKUP_MANIFEST_DOMAIN,
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  SQLITE_CYCLE_STORE_PROVIDER_ID,
  SQLITE_CYCLE_STORE_SCHEMA_VERSION,
  SQLITE_MIGRATION_MANIFEST_SHA256,
  SQLITE_SCHEMA_CATALOG_SHA256,
  SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
} from "../../packages/sqlite/dist/index.js";
import { exerciseSQLiteInterop } from "./sqlite_interop.mjs";

const TEMPORARY_PREFIX = "graph-engineering-sqlite-interop-";
const EXPECTED_REPORT_SHA256 =
  "ba8417d5b9fb2b9fb6c184b1947deadeca268447fae3eb0210aa2b605f449da6";
const EXPECTED_CASE_IDS = Object.freeze([
  "typescript-create-python-validate",
  "python-create-typescript-validate",
  "typescript-event-snapshot-python-append-typescript-continue",
  "python-checkpoint-snapshot-typescript-mutate-python-continue",
  "real-typescript-python-empty-tail-race",
  "cross-runtime-lease-takeover-stale-writer",
  "bidirectional-cross-runtime-backup-restore-continue",
  "cross-runtime-portable-identities",
]);

function temporaryRoots() {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith(TEMPORARY_PREFIX))
    .sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("SQLite TypeScript/Python same-file interop proves all eight retained guarantees twice", {
  timeout: 180_000,
}, async () => {
  const rootsBefore = temporaryRoots();
  const first = await exerciseSQLiteInterop();
  assert.deepEqual(temporaryRoots(), rootsBefore);
  const second = await exerciseSQLiteInterop();
  assert.deepEqual(temporaryRoots(), rootsBefore);
  assert.deepEqual(second, first, "two clean interop runs must be byte-for-byte deterministic");

  assert.deepEqual(Object.keys(first).sort(), [
    "boundedExecution",
    "caseCount",
    "cases",
    "childPidCleanup",
    "childProcessCount",
    "jsonBarrierCount",
    "leakSentinelScan",
    "publicApisOnly",
    "reportSha256",
    "runtimes",
    "sameFileInterop",
    "schemaVersion",
    "suite",
    "temporaryCleanup",
  ]);
  assert.equal(first.suite, "graph-engineering-sqlite-cross-language-interop");
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.runtimes, ["typescript", "python"]);
  assert.equal(first.publicApisOnly, true);
  assert.equal(first.sameFileInterop, true);
  assert.equal(first.caseCount, 8);
  assert.equal(first.cases.length, 8);
  assert.equal(first.childProcessCount, 13);
  assert.equal(first.jsonBarrierCount, 39);
  assert.equal(first.childPidCleanup, "clean");
  assert.equal(first.leakSentinelScan, "clean");
  assert.equal(first.temporaryCleanup, "clean");
  assert.deepEqual(first.boundedExecution, {
    workerTimeoutMs: 20_000,
    maximumCursorPages: 8,
    maximumProtocolLineBytes: 1_048_576,
  });
  assert.deepEqual(first.cases.map(({ id }) => id), EXPECTED_CASE_IDS);
  assert.equal(new Set(first.cases.map(({ id }) => id)).size, 8);
  assert.ok(first.cases.every(({ status }) => status === "passed"));

  const [tsToPython, pythonToTs, events, checkpoints, race, lease, backup, identities] =
    first.cases;
  for (const direction of [tsToPython, pythonToTs]) {
    assert.equal(direction.canonicalPublicBytesExact, true);
    assert.equal(direction.semanticDatabaseIdentityExact, true);
    assert.deepEqual(direction.verifiedFamilies, [
      "records",
      "checkpoint",
      "checkpoint-history",
      "lease-history",
      "legal-hold",
      "event-cursor",
      "operation-ledger",
    ]);
    assert.deepEqual(direction.counters, {
      streams: 1,
      records: 3,
      operations: 8,
      checkpoints: 1,
      checkpointRevisions: 1,
      leases: 1,
      usedLeaseIds: 2,
      legalHolds: 1,
      cursors: 1,
      openCursors: 1,
      usedMigrationLockIds: 0,
    });
  }
  assert.deepEqual(events.snapshotSequences, [0, 1, 2]);
  assert.deepEqual(events.liveSequences, [0, 1, 2, 3]);
  assert.equal(events.postSnapshotAppendExcluded, true);
  assert.equal(events.boundedPageCount, 3);
  assert.deepEqual(checkpoints.snapshotSuffixes, ["c", "b", "a"]);
  assert.deepEqual(checkpoints.liveSuffixes, ["c", "d", "a"]);
  assert.equal(checkpoints.snapshotHasNoSkipOrDuplicate, true);
  assert.equal(checkpoints.liveSaveAndDeleteIsolated, true);
  assert.deepEqual(
    {
      contenders: race.contenders,
      accepted: race.accepted,
      typedConflicts: race.typedConflicts,
      committedRecords: race.committedRecords,
      committedOperations: race.committedOperations,
      winnerNormalized: race.winnerNormalized,
    },
    {
      contenders: 2,
      accepted: 1,
      typedConflicts: 1,
      committedRecords: 1,
      committedOperations: 1,
      winnerNormalized: true,
    },
  );
  assert.equal(lease.staleFence, 1);
  assert.equal(lease.takeoverFence, 2);
  assert.equal(lease.staleWriterCode, "GE_CYCLE_STORE_STALE_FENCE");
  assert.equal(lease.currentWriterCommitted, true);
  assert.equal(lease.finalSequence, 1);
  assert.deepEqual(backup.directions, ["typescript-to-python", "python-to-typescript"]);
  assert.equal(backup.manifestBindingsExact, 2);
  assert.equal(backup.semanticRestoreBindingsExact, 2);
  assert.deepEqual(backup.continuedSequences, { python: 2, typescript: 2 });
  assert.equal(backup.sourceObjectsRemainImmutable, true);
  assert.deepEqual(
    {
      providerId: identities.providerId,
      descriptorHash: identities.descriptorHash,
      applicationId: identities.applicationId,
      schemaVersion: identities.schemaVersion,
      schemaIdentitySha256: identities.schemaIdentitySha256,
      catalogSha256: identities.catalogSha256,
      migrationManifestSha256: identities.migrationManifestSha256,
      schemaSqlSha256: identities.schemaSqlSha256,
      schemaIdentityDocumentSha256: identities.schemaIdentityDocumentSha256,
      alphaV0ToV1SqlSha256: identities.alphaV0ToV1SqlSha256,
      backupManifestApiVersion: identities.backupManifestApiVersion,
      backupManifestDomain: identities.backupManifestDomain,
    },
    {
      providerId: SQLITE_CYCLE_STORE_PROVIDER_ID,
      descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
      applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
      schemaVersion: SQLITE_CYCLE_STORE_SCHEMA_VERSION,
      schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
      catalogSha256: SQLITE_SCHEMA_CATALOG_SHA256,
      migrationManifestSha256: SQLITE_MIGRATION_MANIFEST_SHA256,
      schemaSqlSha256: SQLITE_SCHEMA_SQL_SHA256,
      schemaIdentityDocumentSha256: SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256,
      alphaV0ToV1SqlSha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
      backupManifestApiVersion: SQLITE_BACKUP_MANIFEST_API_VERSION,
      backupManifestDomain: SQLITE_BACKUP_MANIFEST_DOMAIN,
    },
  );
  assert.match(identities.recordCanonicalSha256, /^[0-9a-f]{64}$/u);
  assert.match(identities.operationRequestHash, /^[0-9a-f]{64}$/u);
  assert.equal(identities.semanticIdentityExact, true);

  const { reportSha256, ...body } = first;
  assert.equal(reportSha256, sha256(Buffer.from(canonicalSerialize(body), "utf8")));
  assert.equal(reportSha256, EXPECTED_REPORT_SHA256);
  const canonical = canonicalSerialize(first);
  assert.deepEqual(JSON.parse(canonical), first);
  for (const forbidden of [
    "TS_RACE_PAYLOAD_SENTINEL",
    "PYTHON_RACE_PAYLOAD_SENTINEL",
    "INTEROP_AUTHORIZATION_SENTINEL",
    '"pending"',
    '"skipped"',
    '"cursor"',
    '"pid"',
    "Traceback",
  ]) {
    assert.equal(canonical.includes(forbidden), false);
  }
});
