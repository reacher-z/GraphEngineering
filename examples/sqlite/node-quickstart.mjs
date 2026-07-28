#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCycleStoreRecord,
} from "../../packages/runtime/dist/index.js";
import {
  SQLiteCycleStoreProvider,
  createSQLiteCycleStoreBackup,
  inspectSQLiteCycleStoreIntegrity,
  restoreSQLiteCycleStoreBackup,
} from "../../packages/sqlite/dist/index.js";

const authorization = Object.freeze({
  tenantId: "quickstart-tenant",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const mutation = (operationId) => Object.freeze({ ...authorization, operationId });
const missingTail = Object.freeze({ exists: false, sequence: -1, recordHash: null });

const temporaryRoot = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-example-"));
const sourcePath = join(temporaryRoot, "cycle-store.db");
const backupPath = join(temporaryRoot, "cycle-store.backup.db");
const restoredPath = join(temporaryRoot, "cycle-store.restored.db");

let provider;
let restored;
try {
  provider = new SQLiteCycleStoreProvider(sourcePath);
  const record = createCycleStoreRecord({
    recordId: "record-0",
    sequence: 0,
    previousRecordHash: null,
    value: { status: "ready" },
  });
  const appendRequest = Object.freeze({
    context: mutation("append-record-0"),
    streamId: "example-stream",
    expectedTail: missingTail,
    lease: null,
    records: Object.freeze([record]),
  });
  const appended = await provider.append(appendRequest);
  const schema = await provider.inspectSchema(authorization);

  const migrationLock = await provider.acquireMigrationLock({
    context: mutation("migration-lock-acquire"),
    lockId: "migration-lock-example",
    ownerId: "operator-example",
    sourceSchemaVersion: 1,
    targetSchemaVersion: 2,
    ttlMs: 30_000,
    mode: "acquire",
    expectedFencingToken: 0,
  });
  await provider.releaseMigrationLock({
    context: mutation("migration-lock-release"),
    lockId: migrationLock.lockId,
    ownerId: migrationLock.ownerId,
    fencingToken: migrationLock.fencingToken,
  });

  const sourceAudit = inspectSQLiteCycleStoreIntegrity(sourcePath, "semantic");
  const backup = await createSQLiteCycleStoreBackup(sourcePath, backupPath);
  provider.close();
  provider = undefined;

  const restore = await restoreSQLiteCycleStoreBackup(backupPath, restoredPath);
  restored = new SQLiteCycleStoreProvider(restoredPath);
  const restoredTail = await restored.readTail({
    context: authorization,
    streamId: "example-stream",
  });
  const replay = await restored.append(appendRequest);

  process.stdout.write(`${JSON.stringify({
    providerId: (await restored.describe()).providerId,
    descriptorHash: schema.descriptorHash,
    appendedRecords: appended.appendedRecords,
    restoredTail,
    exactOperationReplay: JSON.stringify(replay) === JSON.stringify(appended),
    sourceSemanticSha256: sourceAudit.semanticSha256,
    backupSemanticSha256: backup.integrity.semanticSha256,
    restoreSemanticSha256: restore.integrity.semanticSha256,
    backupManifestSha256: backup.manifestSha256,
  }, null, 2)}\n`);
} finally {
  provider?.close();
  restored?.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
}
