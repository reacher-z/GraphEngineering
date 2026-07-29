#!/usr/bin/env node
/* Run real TypeScript 128/1024-row B2 campaigns and emit measured JSON evidence. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "../../packages/runtime/dist/cycle-store-provider.js";
import { canonicalSerialize } from "../../packages/core/dist/canonical.js";
import { ensureSQLiteCycleStoreSchema } from "../../packages/sqlite/dist/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from "../../packages/sqlite/dist/operation-baseline-checkpoint-invariants.js";
import {
  beginSQLiteCursorStageOwnershipTransfer,
  createSQLiteCursorSealTempTable,
} from "../../packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js";
import {
  SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
  SQLITE_CURSOR_EVENT_LOOKUP_SQL,
} from "../../packages/sqlite/dist/cursor-pre-rebind-contract.js";
import { SQLiteCursorPreRebindCampaign } from "../../packages/sqlite/dist/operation-baseline-cursor-campaign.js";
import { readSQLiteV1BaselineOrderedTempProjection } from "../../packages/sqlite/dist/operation-baseline-handoff.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from "../../packages/sqlite/dist/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from "../../packages/sqlite/dist/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from "../../packages/sqlite/dist/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
} from "../../packages/sqlite/dist/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from "../../packages/sqlite/dist/operation-baseline-stream-record-invariants.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  SQLITE_CURSOR_MAIN_SOURCE_QUERY,
} from "../../packages/sqlite/dist/operation-baseline-cursor-ownership.js";
import {
  SQLiteCursorSealAccumulator,
  decodeSQLiteCursorSealRow,
} from "../../packages/sqlite/dist/operation-baseline-cursor-invariants.js";
import { captureSQLiteV1BaselineSourceSummary } from "../../packages/sqlite/dist/operation-baseline-source.js";
import { SQLiteConnection } from "../../packages/sqlite/dist/sqlite-connection.js";
import { SQLiteCycleStoreProvider } from "../../packages/sqlite/dist/sqlite-cycle-store.js";
import { createSQLiteCycleStoreDescriptor } from "../../packages/sqlite/dist/sqlite-profile.js";
import { sqliteRow, sqliteText } from "../../packages/sqlite/dist/sqlite-codec.js";

const CAPTURED_AT_MS = 1_785_110_405_000;

function mintReceipt(sourceSummary, projectionIdentity, sealReceipt) {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 1));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability("source-stage", Buffer.alloc(32, 2));
  const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, 3));
  const connectionOwnership = createSQLiteCursorOwnershipCapability("connection", Buffer.alloc(32, 4));
  const session = createSQLiteCursorCaptureSession({
    campaignOwnership, connectionOwnership, nonce: Buffer.alloc(32, 5),
    sourceStageOwnership, tenantOwnership,
  });
  const input = Object.freeze({
    campaignOwnership, clockEvidence: sourceSummary.clockEvidence, connectionOwnership,
    projectionIdentity, projectionReference, sealReceipt, session, sourceStageOwnership,
    sourceSummary, tenantOwnership,
  });
  return new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
}

function physicalValues(descriptor, schema, ordinal, population) {
  const reverse = population - ordinal + 1;
  const tenant = `tenant-scale-${reverse.toString().padStart(4, "0")}`;
  const stream = `stream-scale-${reverse.toString().padStart(4, "0")}`;
  return [
    tenant, ordinal.toString(16).padStart(64, "0"), "event", "b".repeat(64),
    "c".repeat(64), stream, null,
    Buffer.from(`{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"${stream}"}`),
    1, 0, -1, null, descriptor, schema,
    Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
    500, 1_500, null,
  ];
}

async function seedLookupBackedCursors(path) {
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date(CAPTURED_AT_MS),
  });
  const authorization = Object.freeze({
    tenantId: "tenant-a", principalHash: "b".repeat(64), authorizationHash: "c".repeat(64),
  });
  try {
    const first = createCycleStoreRecord({
      recordId: "record-a", sequence: 0, previousRecordHash: null,
      value: { "checkpoint-anchor": true },
    });
    await provider.append({
      context: { ...authorization, operationId: "evidence-append" },
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records: [first],
    });
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "checkpoint-a", streamId: "stream-a",
      boundSequence: 0, boundRecordHash: first.recordHash,
      createdAt: "2026-07-28T00:00:00Z", value: 7,
    });
    await provider.saveCheckpoint({
      context: { ...authorization, operationId: "evidence-save-checkpoint-a" },
      checkpoint,
      lease: null,
    });
    const { value: _value, ...checkpointSummary } = checkpoint;
    return { checkpointSummary, eventTailHash: first.recordHash };
  } finally {
    provider.close();
  }
}

async function run(population) {
  if (population < 2) throw new Error("lookup evidence requires at least two cursors");
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-b2-evidence-"));
  const path = join(root, "cycle-store.db");
  const lookupSeed = await seedLookupBackedCursors(path);
  const connection = new SQLiteConnection(path);
  let stage;
  try {
    const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    configureSQLiteBaselineTempStorage(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const schema = sqliteText(sqliteRow(connection.prepare(
      "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1", "inspect-schema",
    ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
    const insert = connection.prepare(`INSERT INTO ge_cycle_cursors
      (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
       checkpoint_scope,request_scope_blob,page_size,next_position,
       snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
       schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "inspect-schema");
    const canonicalBytes = (value) => Buffer.from(canonicalSerialize(value));
    insert.run(
      "tenant-a", "1".padStart(64, "0"), "event", "b".repeat(64), "c".repeat(64),
      "stream-a", null,
      canonicalBytes({ contractVersion: "cycle-store-provider/v1alpha1", pageSize: 1,
        streamId: "stream-a" }),
      1, 0, 0, lookupSeed.eventTailHash, descriptor, schema,
      canonicalBytes({ exists: true, recordHash: lookupSeed.eventTailHash, sequence: 0 }),
      500, 1_500, null,
    );
    insert.run(
      "tenant-a", "2".padStart(64, "0"), "checkpoint", "b".repeat(64), "c".repeat(64),
      null, "scope-a",
      canonicalBytes({ checkpointScope: "scope-a",
        contractVersion: "cycle-store-provider/v1alpha1", pageSize: 1 }),
      1, 1, null, null, descriptor, schema,
      canonicalBytes([lookupSeed.checkpointSummary]), 500, 1_500, null,
    );
    for (let ordinal = 3; ordinal <= population; ordinal += 1) {
      const values = physicalValues(descriptor, schema, ordinal, population);
      insert.run(...values);
    }
    const accumulator = new SQLiteCursorSealAccumulator(population, descriptor, schema);
    const sealOrderSql = SQLITE_CURSOR_MAIN_SOURCE_QUERY.replace(
      "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
      "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
    );
    for (const row of connection.prepare(sealOrderSql, "inspect-schema").iterate()) {
      accumulator.append(decodeSQLiteCursorSealRow(row));
    }
    const sealReceipt = accumulator.finish();
    stage = createSQLiteBaselineTempStage(connection, proveSQLiteExclusiveBaselineTransaction(connection));
    const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
    stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
    const identity = readSQLiteV1BaselineOrderedTempProjection(connection, sourceSummary, stage);
    for (const report of [
      runSQLiteStreamRecordInvariantCampaign(connection, identity, stage),
      runSQLiteCheckpointInvariantCampaign(connection, identity, stage),
      runSQLiteLeaseLockHoldInvariantCampaign(connection, identity, stage),
      runSQLiteLegacyInvariantCampaign(connection, identity, stage),
    ]) {
      if (report.diagnostics.length !== 0) throw new Error("predecessor campaign diagnosed");
    }
    const receipt = mintReceipt(sourceSummary, identity, sealReceipt);
    const pagesBefore = Number(connection.prepare(
      "SELECT page_count FROM pragma_page_count('temp')", "inspect-schema",
    ).get()[0]);
    const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, stage, receipt);
    createSQLiteCursorSealTempTable(connection, stage, receipt, transfer);
    const campaign = new SQLiteCursorPreRebindCampaign(connection, stage, receipt, transfer);
    const lookupExecutions = { event: 0, checkpoint: 0 };
    const native = DatabaseSync.prototype;
    const originalPrepare = native.prepare;
    native.prepare = function (sql) {
      const statement = Reflect.apply(originalPrepare, this, [sql]);
      const kind = sql === SQLITE_CURSOR_EVENT_LOOKUP_SQL ? "event"
        : sql === SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL ? "checkpoint" : undefined;
      if (kind === undefined) return statement;
      return new Proxy(statement, {
        get(target, property) {
          if (property === "get") {
            return (...parameters) => {
              lookupExecutions[kind] += 1;
              return Reflect.apply(target.get, target, parameters);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    let outcome;
    try {
      outcome = campaign.run();
    } finally {
      native.prepare = originalPrepare;
    }
    if (outcome.status !== "pre-rebind-complete") throw new Error("campaign diagnosed");
    const eqp = campaign.queryPlanEvidence;
    if (eqp.length !== 15) throw new Error("campaign did not retain all registered EQP evidence");
    const pagesAfter = Number(connection.prepare(
      "SELECT page_count FROM pragma_page_count('temp')", "inspect-schema",
    ).get()[0]);
    const observedRoot = assertSQLiteCursorPreRebindReceiptProvenance(outcome.receipt)
      .sealReceipt.immutableRootSha256;
    return {
      population, outcome: outcome.status, exactInputReceipt: outcome.receipt === receipt,
      exactProjectionIdentity: outcome.projectionIdentity === identity,
      expectedRootSha256: sealReceipt.immutableRootSha256, observedRootSha256: observedRoot,
      resourceEvidence: {
        ...campaign.resourceEvidence,
        pointLookupExecutions: lookupExecutions.event + lookupExecutions.checkpoint,
        pointLookupExecutionsByKind: lookupExecutions,
        pointLookupEvidence: "instrumented-native-statement-get",
        finalActiveRegisteredCursors: campaign.resourceEvidence.currentActiveRegisteredCursors,
        tempObjectCount: Number(connection.prepare(
          "SELECT count(*) FROM temp.sqlite_schema WHERE name='ge_blr_cursor_seal'", "inspect-schema",
        ).get()[0]),
        tempRowCount: Number(connection.prepare(
          "SELECT count(*) FROM temp.ge_blr_cursor_seal", "inspect-schema",
        ).get()[0]),
        tempObjectMeasurementProvenance: campaign.resourceEvidence.tempObjectCountEvidence,
        tempPageCountBefore: pagesBefore, tempPageCountAfter: pagesAfter,
      },
      eqpEvidenceProvenance: "in-campaign-registered-cursor",
      eqp,
    };
  } finally {
    try { stage?.dispose(); } catch {}
    if (connection.isOpen) {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
    rmSync(root, { recursive: true, force: true });
  }
}

const populations = process.argv.slice(2).map(Number);
if (populations.some((population) => ![128, 1_024].includes(population))) {
  throw new Error("production evidence population must be 128 or 1024");
}
const campaigns = [];
for (const population of populations.length === 0 ? [128, 1_024] : populations) {
  campaigns.push(await run(population));
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  runtime: "typescript",
  contract: "sqlite-cursor-pre-rebind-v1-production-campaign-evidence",
  campaigns,
})}\n`);
