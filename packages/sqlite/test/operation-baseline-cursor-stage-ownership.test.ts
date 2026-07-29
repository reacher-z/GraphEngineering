import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "@graph-engineering/runtime";

import * as sqlitePackage from "../src/index.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from "../src/operation-baseline-checkpoint-invariants.js";
import {
  SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER,
  SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER,
  SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE,
  SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER,
  type SQLiteBaselineCursorStageTransferOwner,
} from "../src/operation-baseline-cooperation.js";
import {
  beginSQLiteCursorStageOwnershipTransfer,
  assertSQLiteCursorStageOwnershipTransfer,
  createSQLiteCursorSealTempTable,
  type SQLiteCursorStageOwnershipTransfer,
} from "../src/operation-baseline-cursor-stage-ownership.js";
import {
  SQLITE_CURSOR_COUNT_MARKER_SQL,
  SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
  SQLITE_CURSOR_EVENT_LOOKUP_SQL,
  SQLITE_CURSOR_PRE_REBIND_RULE_ORDER,
  SQLITE_CURSOR_ROW_RULES,
  SQLITE_CURSOR_STAGE_INSERT_SQL,
  SQLITE_CURSOR_STAGE_SEAL_SQL,
} from "../src/cursor-pre-rebind-contract.js";
import {
  SQLiteCursorPreRebindCampaign,
  SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL,
  createSQLiteCursorPreRebindCancellationController,
  createSQLiteCursorPreRebindLabelCancellationController,
  runSQLiteCursorPreRebindCampaign,
} from "../src/operation-baseline-cursor-campaign.js";
import {
  SQLITE_CURSOR_SEAL_SCHEMA_SQL,
  SQLITE_CURSOR_SEAL_TABLE_LIST,
  SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL,
  SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL_SHA256,
  SQLITE_CURSOR_SEAL_XINFO,
} from "../src/cursor-seal-temp-table-contract.js";
import { readSQLiteV1BaselineOrderedTempProjection } from "../src/operation-baseline-handoff.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from "../src/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from "../src/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from "../src/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  type SQLiteBaselineTempStage,
} from "../src/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from "../src/operation-baseline-stream-record-invariants.js";
import {
  OperationBaselineAccumulator,
  createOperationBaselineId,
  type OperationBaselineProjectionIdentity,
} from "../src/operation-baseline.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindConnectionProvenance,
  assertSQLiteCursorPreRebindConnectionProvenanceWitness,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  type SQLiteCursorPreRebindReceipt,
} from "../src/operation-baseline-cursor-ownership.js";
import {
  SQLiteCursorSealAccumulator,
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  decodeSQLiteCursorSealRow,
  sealSQLiteCursorRows,
  type SQLiteCursorSealReceipt,
} from "../src/operation-baseline-cursor-invariants.js";
import { SQLITE_CURSOR_MAIN_SOURCE_QUERY } from "../src/operation-baseline-cursor-ownership.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import { sqliteRow, sqliteText } from "../src/sqlite-codec.js";
import { SQLiteCycleStoreProvider } from "../src/sqlite-cycle-store.js";

const CAPTURED_AT_MS = 1_785_110_405_000;
const roots: string[] = [];

type CompletedPhase = "ordered" | "stream" | "checkpoint" | "lease" | "legacy";

interface PreparedRun {
  readonly connection: SQLiteConnection;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly stage: SQLiteBaselineTempStage;
}

function openConnection<T extends SQLiteConnection>(
  Connection: new (path: string) => T = SQLiteConnection as new (path: string) => T,
): T {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-cursor-stage-owner-"));
  roots.push(root);
  const connection = new Connection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: CAPTURED_AT_MS,
  });
  configureSQLiteBaselineTempStorage(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  return connection;
}

function mintReceipt(
  sourceSummary: SQLiteV1BaselineSourceSummary,
  projectionIdentity: OperationBaselineProjectionIdentity,
  providedSealReceipt?: SQLiteCursorSealReceipt,
): SQLiteCursorPreRebindReceipt {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt = providedSealReceipt ?? Object.freeze({
    cursorCount: 0,
    immutableRootSha256: SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    sourceDescriptorHash: sourceSummary.sourceEnvelope.sourceDescriptorHash,
    sourceSchemaIdentitySha256: sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
  });
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 1));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability(
    "source-stage",
    Buffer.alloc(32, 2),
  );
  const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, 3));
  const connectionOwnership = createSQLiteCursorOwnershipCapability(
    "connection",
    Buffer.alloc(32, 4),
  );
  const session = createSQLiteCursorCaptureSession({
    campaignOwnership,
    connectionOwnership,
    nonce: Buffer.alloc(32, 5),
    sourceStageOwnership,
    tenantOwnership,
  });
  const input = Object.freeze({
    campaignOwnership,
    clockEvidence: sourceSummary.clockEvidence,
    connectionOwnership,
    projectionIdentity,
    projectionReference,
    sealReceipt,
    session,
    sourceStageOwnership,
    sourceSummary,
    tenantOwnership,
  });
  return new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
}

function prepareThrough(
  phase: CompletedPhase,
  connection = openConnection(),
): PreparedRun {
  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  );
  const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
  stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection,
    sourceSummary,
    stage,
  );
  if (["stream", "checkpoint", "lease", "legacy"].includes(phase)) {
    expect(runSQLiteStreamRecordInvariantCampaign(
      connection,
      projectionIdentity,
      stage,
    ).diagnostics).toEqual([]);
  }
  if (["checkpoint", "lease", "legacy"].includes(phase)) {
    expect(runSQLiteCheckpointInvariantCampaign(
      connection,
      projectionIdentity,
      stage,
    ).diagnostics).toEqual([]);
  }
  if (["lease", "legacy"].includes(phase)) {
    expect(runSQLiteLeaseLockHoldInvariantCampaign(
      connection,
      projectionIdentity,
      stage,
    ).diagnostics).toEqual([]);
  }
  if (phase === "legacy") {
    expect(runSQLiteLegacyInvariantCampaign(
      connection,
      projectionIdentity,
      stage,
    ).diagnostics).toEqual([]);
  }
  return {
    connection,
    projectionIdentity,
    receipt: mintReceipt(sourceSummary, projectionIdentity),
    sourceSummary,
    stage,
  };
}

function totalChanges(connection: SQLiteConnection): number {
  return Number((connection.prepare(
    "SELECT total_changes()",
    "inspect-schema",
  ).get() as unknown as readonly [number | bigint])[0]);
}

function reservedObjects(connection: SQLiteConnection): readonly string[] {
  return connection.prepare(
    "SELECT type || ':' || name FROM temp.sqlite_schema "
      + "WHERE substr(lower(name), 1, 7) = 'ge_blr_' ORDER BY 1",
    "inspect-schema",
  ).all().map((row) => String((row as unknown as readonly [unknown])[0]));
}

function cleanup(run: Pick<PreparedRun, "connection" | "stage">): void {
  try {
    run.stage.dispose();
  } catch {
    // A hostile case may intentionally poison or replace the owner epoch.
  }
  if (run.connection.isOpen) {
    if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
    run.connection.close();
  }
}

function permanentCursorDigest(connection: SQLiteConnection): string {
  const rows = connection.prepare(
    `SELECT * FROM (${SQLITE_CURSOR_MAIN_SOURCE_QUERY})`, "inspect-schema",
  ).all().map((row) => (row as readonly unknown[]).map((value) => {
    if (typeof value === "bigint") return `integer:${value.toString(10)}`;
    if (value instanceof Uint8Array) return `blob:${Buffer.from(value).toString("hex")}`;
    return value;
  }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function assertCursorFailurePostconditions(
  run: PreparedRun,
  permanentBefore: string,
  exposed: unknown,
): void {
  const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
  const rendered = exposed instanceof Error
    ? `${exposed.name}:${exposed.message}:${JSON.stringify(exposed)}`
    : JSON.stringify(exposed) ?? "";
  for (const secret of [
    witness.sealReceipt.immutableRootSha256,
    witness.sealReceipt.sourceDescriptorHash,
    witness.sealReceipt.sourceSchemaIdentitySha256,
  ]) expect(rendered).not.toContain(secret);
  expect(rendered).not.toMatch(/tenant-\d/u);
  if (run.connection.isOpen) {
    expect(permanentCursorDigest(run.connection)).toBe(permanentBefore);
  }
  run.stage.dispose();
  if (run.connection.isOpen) {
    expect(permanentCursorDigest(run.connection)).toBe(permanentBefore);
    if (run.connection.isTransaction) {
      expect(reservedObjects(run.connection)).not.toContain("table:ge_blr_cursor_seal");
    }
  }
}

function cursorPhysicalValues(
  descriptor: string,
  schema: string,
  ordinal: number,
): unknown[] {
  return [
    `tenant-${ordinal}`, ordinal.toString(16).padStart(64, "0"), "event",
    "2".repeat(64), "3".repeat(64), `stream-${ordinal}`, null,
    Buffer.from(`{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"stream-${ordinal}"}`),
    1, 0, -1, null, descriptor, schema,
    Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
    CAPTURED_AT_MS, CAPTURED_AT_MS + 1, null,
  ];
}

function insertCursorPhysicalRow(
  connection: SQLiteConnection,
  mutate: (values: unknown[]) => void,
  ordinal = 1,
): readonly [string, string] {
  const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
  const schema = sqliteText(sqliteRow(connection.prepare(
    "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
    "inspect-schema",
  ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
  const values = cursorPhysicalValues(descriptor, schema, ordinal);
  mutate(values);
  connection.prepare(`INSERT INTO ge_cycle_cursors
    (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
     checkpoint_scope,request_scope_blob,page_size,next_position,
     snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
     schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "inspect-schema").run(...values as never[]);
  return [descriptor, schema];
}

function mutatePhysicalRowToCheckpoint(
  values: unknown[],
  summaries: readonly Readonly<Record<string, unknown>>[],
): void {
  values[2] = "checkpoint";
  values[5] = null;
  values[6] = "checkpoint-scope";
  values[7] = Buffer.from(
    '{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":1}',
  );
  values[9] = summaries.length;
  values[10] = null;
  values[11] = null;
  values[14] = Buffer.from(canonicalSerialize(summaries));
}

const CHECKPOINT_SUMMARY = Object.freeze({
  boundRecordHash: "d".repeat(64),
  boundSequence: 6,
  checkpointId: "cp-a",
  checkpointScope: "checkpoint-scope",
  createdAt: "2026-07-28T00:00:00Z",
  streamId: "stream-alpha",
  valueBytes: 2,
  valueHash: "a".repeat(64),
});

function wrapNativeStatement(
  statement: StatementSync,
  overrides: Readonly<Record<string, (...parameters: never[]) => unknown>>,
): StatementSync {
  return new Proxy(statement, {
    get(target, property) {
      if (typeof property === "string" && Object.hasOwn(overrides, property)) {
        return overrides[property];
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) as unknown : value;
    },
  });
}

const CLOSED_PLAN_BOUNDARIES = [
  "before-prepare", "after-prepare", "before-fetch", "after-fetch",
  "before-close", "after-close",
] as const;

const CLOSED_CAMPAIGN_BOUNDARY_LABELS = Object.freeze([
  "run:start",
  ...["source", "event-lookup", "checkpoint-lookup", "stage-insert"]
    .flatMap((kind) => CLOSED_PLAN_BOUNDARIES.map((boundary) => `plan:${kind}:${boundary}`)),
  "event-lookup:before-prepare",
  "event-lookup:after-prepare",
  "checkpoint-lookup:before-prepare",
  "checkpoint-lookup:after-prepare",
  ...["before-prepare", "after-prepare", "before-fetch", "after-fetch", "before-close", "after-close"]
    .map((boundary) => `source:${boundary}`),
  ...SQLITE_CURSOR_PRE_REBIND_RULE_ORDER.flatMap((ruleId) => [
    `rule:${ruleId}:start`,
    ...CLOSED_PLAN_BOUNDARIES.map((boundary) => `plan:${ruleId}:${boundary}`),
    ...CLOSED_PLAN_BOUNDARIES.map((boundary) => `rule:${ruleId}:${boundary}`),
  ]),
  ...CLOSED_PLAN_BOUNDARIES.map((boundary) => `plan:stage-seal:${boundary}`),
  ...CLOSED_PLAN_BOUNDARIES.map((boundary) => `seal:${boundary}`),
  "publish:complete",
]);
const CLOSED_CAMPAIGN_BOUNDARY_CASES = Object.freeze(
  CLOSED_CAMPAIGN_BOUNDARY_LABELS.map((label) => ({
    caseId: label === "publish:complete" ? "cancel-before-complete"
      : label.startsWith("rule:") || label.startsWith("plan:BLR_CURSOR_")
        ? "cancel-at-rule"
        : label.startsWith("seal:") || label.startsWith("plan:stage-seal:")
          ? "cancel-at-seal"
          : "cancel-at-source",
    label,
  })),
);

describe("SQLite Cursor Slice B0b stage ownership transfer", () => {
  it("atomically binds the exact completed stage without SQL, TEMP, epoch, or row changes", () => {
    const run = prepareThrough("legacy");
    try {
      const epoch = readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch;
      const changes = totalChanges(run.connection);
      const objects = reservedObjects(run.connection);
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      );

      expect(Object.isFrozen(transfer)).toBe(true);
      expect(Object.getPrototypeOf(transfer)).toBeNull();
      expect(Reflect.ownKeys(transfer)).toEqual([]);
      expect(readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch).toBe(epoch);
      expect(totalChanges(run.connection)).toBe(changes);
      expect(reservedObjects(run.connection)).toEqual(objects);
      expect(reservedObjects(run.connection).some((value) => value.includes("cursor"))).toBe(false);
      expect(assertSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
        transfer,
      )).toBe(transfer);
      expect(assertSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
        transfer,
      )).toBe(transfer);
      expect(Object.keys(sqlitePackage)).not.toContain(
        "beginSQLiteCursorStageOwnershipTransfer",
      );
      expect(Object.keys(sqlitePackage)).not.toContain(
        "assertSQLiteCursorStageOwnershipTransfer",
      );
      expect(Object.keys(sqlitePackage)).not.toContain(
        "readSQLiteConnectionTotalChangesSnapshot",
      );
    } finally {
      cleanup(run);
    }
  });

  it("rejects forged transfer clones and receipts from another exact issuer [b2:transfer-clone]", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      );
      const clone = Object.freeze(Object.create(null)) as SQLiteCursorStageOwnershipTransfer;
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
        clone,
      )).toThrow(/transfer provenance/u);
      const otherReceipt = mintReceipt(run.sourceSummary, run.projectionIdentity);
      expect(assertSQLiteCursorPreRebindReceiptProvenance(otherReceipt).sourceSummary)
        .toBe(run.sourceSummary);
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        otherReceipt,
        transfer,
      )).toThrow(/transfer provenance/u);
    } finally {
      cleanup(run);
    }
  });

  it("keeps the exact B0a witness reusable until the owned B1 epoch transition", () => {
    const run = prepareThrough("legacy");
    try {
      const witness = assertSQLiteCursorPreRebindConnectionProvenance(
        run.connection,
        run.receipt,
      );
      const owner = run.stage as SQLiteBaselineTempStage
        & SQLiteBaselineCursorStageTransferOwner;
      owner[SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER](
        run.connection,
        run.receipt,
        witness,
      );
      expect(assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        run.connection,
        run.receipt,
        witness,
      )).toBe(witness);
      expect(run.stage.state).toBe("open");
    } finally {
      cleanup(run);
    }
  });

  it("runs A2b before connection or stage observation", () => {
    const connection = openConnection();
    connection.execTrusted("ROLLBACK", "inspect-schema");
    connection.close();
    expect(() => beginSQLiteCursorStageOwnershipTransfer(
      connection,
      Object.freeze(Object.create(null)) as SQLiteBaselineTempStage,
      Object.freeze(Object.create(null)) as SQLiteCursorPreRebindReceipt,
    )).toThrow(/receipt provenance/u);
  });

  it("rejects a wrong connection before touching the valid stage", () => {
    const run = prepareThrough("legacy");
    const wrong = openConnection();
    try {
      expect(() => beginSQLiteCursorStageOwnershipTransfer(wrong, run.stage, run.receipt))
        .toThrow(/captured source provenance/u);
      expect(run.stage.state).toBe("open");
      run.stage.assertCommonCounts(run.sourceSummary.countsByKind);
    } finally {
      cleanup(run);
      wrong.execTrusted("ROLLBACK", "inspect-schema");
      wrong.close();
    }
  });

  it("rejects a different exact completed stage and never publishes a handle", () => {
    const sourceRun = prepareThrough("legacy");
    const wrongStageRun = prepareThrough("legacy");
    try {
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        sourceRun.connection,
        wrongStageRun.stage,
        sourceRun.receipt,
      )).toThrow(/transfer binding/u);
      expect(sourceRun.stage.state).toBe("open");
      expect(wrongStageRun.stage.state).toBe("poisoned");
      expect(reservedObjects(sourceRun.connection).some((value) => value.includes("cursor")))
        .toBe(false);
    } finally {
      cleanup(sourceRun);
      cleanup(wrongStageRun);
    }
  });

  it("rejects a prototype-derived stage clone before its private hook can run", () => {
    const run = prepareThrough("legacy");
    try {
      const clone = Object.create(run.stage) as SQLiteBaselineTempStage;
      expect(clone).not.toBe(run.stage);
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        clone,
        run.receipt,
      )).toThrow();
      expect(run.stage.state).toBe("open");
    } finally {
      cleanup(run);
    }
  });

  it("requires the exact stage-owned projection identity [b2:projection-clone]", () => {
    const run = prepareThrough("legacy");
    try {
      const clone = Object.freeze({ ...run.projectionIdentity });
      const receipt = mintReceipt(run.sourceSummary, clone);
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        receipt,
      )).toThrow(/transfer binding/u);
      expect(run.stage.state).toBe("poisoned");
      expect(reservedObjects(run.connection).some((value) => value.includes("cursor"))).toBe(false);
    } finally {
      cleanup(run);
    }
  });

  it("rejects before cooperative load and ordered projection completion", () => {
    const connection = openConnection();
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
    const accumulator = new OperationBaselineAccumulator(
      createOperationBaselineId(sourceSummary.sourceEnvelope),
      sourceSummary.expectedEntryCount,
    );
    for (const entry of sourceSummary.entries()) accumulator.append(entry);
    const projectionIdentity = accumulator.finish();
    const run = {
      connection,
      projectionIdentity,
      receipt: mintReceipt(sourceSummary, projectionIdentity),
      sourceSummary,
      stage,
    };
    try {
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        connection,
        stage,
        run.receipt,
      )).toThrow(/transfer binding/u);
      expect(stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  for (const phase of ["ordered", "stream", "checkpoint", "lease"] as const) {
    it(`rejects the incomplete predecessor phase ${phase}`, () => {
      const run = prepareThrough(phase);
      try {
        expect(() => beginSQLiteCursorStageOwnershipTransfer(
          run.connection,
          run.stage,
          run.receipt,
        )).toThrow(/transfer binding/u);
        expect(run.stage.state).toBe("poisoned");
        expect(reservedObjects(run.connection).some((value) => value.includes("cursor"))).toBe(false);
      } finally {
        cleanup(run);
      }
    });
  }

  it("rejects before-legacy-complete predecessor state [b2:before-legacy-complete]", () => {
    const run = prepareThrough("lease");
    try {
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      )).toThrow(/transfer binding/u);
      expect(run.stage.state).toBe("poisoned");
      expect(reservedObjects(run.connection).some((value) => value.includes("cursor")))
        .toBe(false);
    } finally {
      cleanup(run);
    }
  });

  it("rejects unexplained TEMP DML through the stage-owned counter fence", () => {
    const run = prepareThrough("legacy");
    try {
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      )).toThrow(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  it("rejects counter drift after transfer through the retained stage owner", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      );
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
        transfer,
      )).toThrow(/owner fence changed|unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  it("rejects rollback/rebegin without publishing or poisoning through stale source authority", () => {
    const run = prepareThrough("legacy");
    try {
      run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      )).toThrow(/captured transaction/u);
      expect(run.stage.state).toBe("open");
    } finally {
      cleanup(run);
    }
  });

  it("burns the stage latch and rejects a second begin", () => {
    const run = prepareThrough("legacy");
    try {
      beginSQLiteCursorStageOwnershipTransfer(run.connection, run.stage, run.receipt);
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      )).toThrow(/transfer binding/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  it("catches counter drift injected during stage inspection before publication", () => {
    const run = prepareThrough("legacy");
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const allowedChanges = totalChanges(run.connection);
    let injected = false;
    try {
      run.connection.prepare = ((sql: string, operation: "inspect-schema") => {
        if (sql === "SELECT total_changes()") {
          if (!injected) {
            injected = true;
            originalPrepare(
              "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
              "inspect-schema",
            ).run();
          }
          return Object.freeze({
            get: () => [BigInt(allowedChanges)],
          }) as unknown as ReturnType<SQLiteConnection["prepare"]>;
        }
        return originalPrepare(sql, operation);
      }) as SQLiteConnection["prepare"];
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      )).toThrow(/transfer epoch is invalid/u);
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      cleanup(run);
    }
  });

  it("catches hostile epoch advancement during stage inspection before publication", () => {
    class RacingConnection extends SQLiteConnection {
      #armed = false;

      arm(): void {
        this.#armed = true;
      }

      override get transactionEpoch(): bigint {
        const reported = super.transactionEpoch;
        if (this.#armed) {
          this.#armed = false;
          this.prepare("PRAGMA schema_version", "inspect-schema").get();
        }
        return reported;
      }
    }

    const run = prepareThrough("legacy", openConnection(RacingConnection));
    try {
      const capturedEpoch = readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch;
      run.connection.arm();
      expect(() => beginSQLiteCursorStageOwnershipTransfer(
        run.connection,
        run.stage,
        run.receipt,
      )).toThrow();
      expect(readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch)
        .toBe(capturedEpoch + 1n);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });
});

describe("SQLite Cursor Slice B2 pre-rebind campaign", () => {
  it("reproduces the empty A1 authority and returns the exact input receipt [b2:second-run]", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      const outcome = campaign.run();
      expect(outcome).toMatchObject({
        status: "pre-rebind-complete",
        diagnostics: [],
        vector: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      });
      if (outcome.status !== "pre-rebind-complete") throw new Error("unexpected diagnosis");
      expect(outcome.receipt).toBe(run.receipt);
      expect(outcome.projectionIdentity).toBe(run.projectionIdentity);
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(campaign.queryPlanEvidence).toHaveLength(15);
      expect(campaign.queryPlanEvidence.map(({ kind }) => kind)).toEqual([
        "source", "stage-insert", "stage-seal", "count-marker",
        "event-lookup", "checkpoint-lookup",
        ...Array<string>(9).fill("row-marker"),
      ]);
      expect(campaign.queryPlanEvidence.every((item) =>
        Object.isFrozen(item) && Object.isFrozen(item.details))).toBe(true);
      expect(() => campaign.run()).toThrow(/one-shot/u);
      expect(campaign.state).toBe("poisoned");
      expect(Object.keys(sqlitePackage)).not.toContain("runSQLiteCursorPreRebindCampaign");
    } finally {
      cleanup(run);
    }
  });

  it.each(["key-storage", "wrong-arity"] as const)(
    "counts the exact independent rules for a physically nonstageable %s row",
    (hostility) => {
      const run = prepareThrough("legacy");
      const native = DatabaseSync.prototype as unknown as {
        prepare(sql: string): StatementSync;
      };
      const originalPrepare = native.prepare;
      const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
      const schema = sqliteText(sqliteRow(run.connection.prepare(
        "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
        "inspect-schema",
      ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
      const physical: unknown[] = [
        hostility === "key-storage" ? 7n : "tenant-a", "1".repeat(64), "event",
        "2".repeat(64), "3".repeat(64), "stream-a", null,
        Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"stream-a"}'),
        1n, 0n, -1n, null, descriptor, schema,
        Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
        BigInt(CAPTURED_AT_MS), BigInt(CAPTURED_AT_MS + 1), null,
      ];
      if (hostility === "wrong-arity") physical.pop();
      let injected = false;
      try {
        native.prepare = function (sql: string): StatementSync {
          if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
            injected = true;
            return {
              iterate: () => [physical].values(),
              setAllowBareNamedParameters: () => undefined,
              setAllowUnknownNamedParameters: () => undefined,
              setReadBigInts: () => undefined,
              setReturnArrays: () => undefined,
            } as unknown as StatementSync;
          }
          return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        };
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt,
        );
        createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
        const campaign = new SQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
        const outcome = campaign.run();
        expect(injected).toBe(true);
        expect(outcome.status).toBe("diagnosed");
        expect(outcome.vector).toEqual(hostility === "key-storage"
          ? [1, 0, 0, 0, 0, 0, 1, 1, 0, 0]
          : [0, 0, 0, 0, 0, 0, 1, 1, 0, 0]);
        expect(outcome.diagnostics).toEqual(hostility === "key-storage"
          ? [
            { ruleId: "BLR_CURSOR_AUTHORIZATION", violationCount: 1,
              diagnosticsTruncated: false },
            { ruleId: "BLR_CURSOR_SEAL_COUNT", violationCount: 1,
              diagnosticsTruncated: false },
            { ruleId: "BLR_CURSOR_SHAPE", violationCount: 1,
              diagnosticsTruncated: false },
          ]
          : [
            { ruleId: "BLR_CURSOR_SEAL_COUNT", violationCount: 1,
              diagnosticsTruncated: false },
            { ruleId: "BLR_CURSOR_SHAPE", violationCount: 1,
              diagnosticsTruncated: false },
          ]);
        expect(run.connection.prepare(
          "SELECT count(*) FROM temp.ge_blr_cursor_seal", "inspect-schema",
        ).get()).toEqual([0n]);
        expect("receipt" in outcome).toBe(false);
        expect(JSON.stringify(outcome)).not.toMatch(/immutableRoot|sourceDescriptor/u);
        expect(campaign.queryPlanEvidence).toHaveLength(15);
        expect(campaign.queryPlanEvidence[2]).toMatchObject({
          kind: "stage-seal",
          sql: SQLITE_CURSOR_STAGE_SEAL_SQL,
        });
        expect(campaign.resourceEvidence).toMatchObject({
          currentActiveRegisteredCursors: 0,
          maximumActiveRegisteredCursors: 1,
        });
        expect(() => campaign.run()).toThrow(/one-shot/u);
        expect(campaign.state).toBe("poisoned");
      } finally {
        native.prepare = originalPrepare;
        cleanup(run);
      }
    },
  );

  it("stages two oversized TEXT keys under unique bounded sentinels as Rule 1 only", () => {
    const run = prepareThrough("legacy");
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const oversizedTenant = "t".repeat(100_000);
    const oversizedToken = "f".repeat(100_000);
    const rows = [1, 2].map((ordinal) => {
      const physical = cursorPhysicalValues(descriptor, schema, ordinal);
      physical[0] = oversizedTenant;
      physical[1] = oversizedToken;
      return physical;
    });
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 2,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          injected = true;
          return {
            iterate: () => rows.values(),
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, receipt, transfer,
      );
      const outcome = campaign.run();
      expect(injected).toBe(true);
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(outcome.diagnostics).toEqual([{
        ruleId: "BLR_CURSOR_AUTHORIZATION",
        violationCount: 2,
        diagnosticsTruncated: false,
      }]);
      const staged = run.connection.prepare(
        "SELECT token_hash, tenant_id, authorization_ok, scope_ok, blobs_canonical_ok, "
          + "position_ok, clock_ok, catalog_ok, shape_ok, event_binding_ok, "
          + "checkpoint_binding_ok, seal_eligible FROM temp.ge_blr_cursor_seal "
          + "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
        "inspect-schema",
      ).all() as unknown as readonly (readonly unknown[])[];
      expect(staged).toHaveLength(2);
      expect(staged.map((row) => row.slice(2))).toEqual([
        [0n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n],
        [0n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n],
      ]);
      const stagedKeys = staged.map((row) => [String(row[0]), String(row[1])] as const);
      const expectedKeys = [1, 2].map((ordinal) => [
        `!ge-invalid-token-${ordinal}`,
        `!ge-invalid-${ordinal}-tenant`,
      ] as const);
      expect(new Set(stagedKeys.map(([token, tenant]) => `${token}:${tenant}`)).size).toBe(2);
      expect(new Set(stagedKeys.map(([token, tenant]) => `${token}:${tenant}`))).toEqual(
        new Set(expectedKeys.map(([token, tenant]) => `${token}:${tenant}`)),
      );
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_cursor_seal WHERE seal_eligible = 1",
        "inspect-schema",
      ).get()).toEqual([0n]);
      for (const [token, tenant] of stagedKeys) {
        expect(token).toMatch(/^!ge-invalid-token-[12]$/u);
        expect(tenant).toMatch(/^!ge-invalid-[12]-tenant$/u);
        expect(token).not.toBe(oversizedToken);
        expect(tenant).not.toBe(oversizedTenant);
        expect(JSON.stringify(outcome)).not.toContain(token);
        expect(JSON.stringify(outcome)).not.toContain(tenant);
      }
      expect(JSON.stringify(outcome)).not.toContain(oversizedTenant.slice(0, 256));
      expect(JSON.stringify(outcome)).not.toContain(oversizedToken.slice(0, 256));
      expect("receipt" in outcome).toBe(false);
      expect(campaign.state).toBe("diagnosed");
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("keeps an ordinal sentinel collision diagnosed without poisoning or changing main", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const sentinelDomain = Buffer.from(
      "graph-engineering/sqlite-cursor-inspection-sentinel/v1\0", "ascii",
    );
    const ordinalTwoSentinelToken = createHash("sha256").update(sentinelDomain)
      .update("2:token", "ascii").digest("hex");
    const formerlyColliding = cursorPhysicalValues(descriptor, schema, 1);
    formerlyColliding[0] = "tenant-z";
    formerlyColliding[1] = ordinalTwoSentinelToken;
    const hostile = cursorPhysicalValues(descriptor, schema, 2);
    hostile[0] = "tenant-z";
    hostile[1] = "f".repeat(100_000);
    const rows = [formerlyColliding, hostile];
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 2,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          injected = true;
          return {
            iterate: () => rows.values(),
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, receipt, transfer,
      );
      const outcome = campaign.run();
      expect(injected).toBe(true);
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(outcome.diagnostics).toEqual([{
        ruleId: "BLR_CURSOR_AUTHORIZATION",
        violationCount: 1,
        diagnosticsTruncated: false,
      }]);
      expect(run.connection.prepare(
        "SELECT token_hash, tenant_id, seal_eligible "
          + "FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY",
        "inspect-schema",
      ).all()).toEqual([
        ["!ge-invalid-token-2", "tenant-z", 0n],
        [ordinalTwoSentinelToken, "tenant-z", 1n],
      ]);
      expect(permanentCursorDigest(run.connection)).toBe(permanentBefore);
      expect("receipt" in outcome).toBe(false);
      expect(campaign.state).toBe("diagnosed");
      expect(run.stage.state).toBe("open");
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt, transfer,
      )).toThrow(/provenance is invalid/u);
      expect(run.stage.state).toBe("open");
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("completes a real hardened nonempty event row and reproduces A1", () => {
    const connection = openConnection();
    const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    const schema = sqliteText(sqliteRow(connection.prepare(
      "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
      "inspect-schema",
    ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
    connection.prepare(`INSERT INTO ge_cycle_cursors
      (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
       checkpoint_scope,request_scope_blob,page_size,next_position,
       snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
       schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`, "inspect-schema").run(
      "tenant-a", "1".repeat(64), "event", "2".repeat(64), "3".repeat(64),
      "stream-a", null,
      Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"stream-a"}'),
      1, 0, -1, null, descriptor, schema,
      Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
      CAPTURED_AT_MS, CAPTURED_AT_MS + 1,
    );
    const run = prepareThrough("legacy", connection);
    try {
      const rows = [...connection.prepare(
        SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
      ).iterate()].map(decodeSQLiteCursorSealRow);
      const actualSeal = sealSQLiteCursorRows(1, descriptor, schema, rows);
      const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, actualSeal);
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      if (outcome.status !== "pre-rebind-complete") throw new Error("unexpected diagnosis");
      expect(outcome.receipt).toBe(receipt);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    { caseId: "page-size-one", mutate: (_values: unknown[]) => undefined },
    {
      caseId: "page-size-256",
      mutate: (values: unknown[]) => {
        values[7] = Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":256,"streamId":"stream-1"}');
        values[8] = 256;
      },
    },
    {
      caseId: "consumed-clock-valid",
      mutate: (values: unknown[]) => {
        values[15] = CAPTURED_AT_MS - 10;
        values[16] = CAPTURED_AT_MS + 10;
        values[17] = CAPTURED_AT_MS - 10;
      },
    },
    {
      caseId: "expired-locally-valid",
      mutate: (values: unknown[]) => {
        values[15] = CAPTURED_AT_MS - 20;
        values[16] = CAPTURED_AT_MS - 1;
      },
    },
  ].map((testCase) => [
    `accepts pristine boundary ${testCase.caseId} [b2:${testCase.caseId}]`, testCase,
  ] as const))("%s", (_title, { mutate }) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, mutate, 1);
    const run = prepareThrough("legacy", connection);
    try {
      const rows = [...connection.prepare(
        SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
      ).iterate()].map(decodeSQLiteCursorSealRow).sort((left, right) =>
        Buffer.compare(Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash))
          || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
      const receipt = mintReceipt(
        run.sourceSummary, run.projectionIdentity,
        sealSQLiteCursorRows(1, descriptor, schema, rows),
      );
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    } finally {
      cleanup(run);
    }
  });

  it("accepts the same token hash for two tenants through the composite TEMP key [b2:same-token-two-tenants]", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined, 1);
    insertCursorPhysicalRow(connection, () => undefined, 2);
    connection.prepare(
      "UPDATE main.ge_cycle_cursors SET token_hash = ?",
      "inspect-schema",
    ).run("a".repeat(64));
    const run = prepareThrough("legacy", connection);
    try {
      const rows = [...connection.prepare(
        SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
      ).iterate()].map(decodeSQLiteCursorSealRow).sort((left, right) =>
        Buffer.compare(Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash))
          || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
      const receipt = mintReceipt(
        run.sourceSummary, run.projectionIdentity,
        sealSQLiteCursorRows(2, descriptor, schema, rows),
      );
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(connection.prepare(
        "SELECT token_hash,tenant_id FROM temp.ge_blr_cursor_seal ORDER BY token_hash,tenant_id",
        "inspect-schema",
      ).all()).toEqual([
        ["a".repeat(64), "tenant-1"],
        ["a".repeat(64), "tenant-2"],
      ]);
    } finally {
      cleanup(run);
    }
  });

  it.each([128, 1_024])(
    "streams %i real cursors when source and seal orders conflict",
    (population) => {
      const connection = openConnection();
      const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
      const schema = sqliteText(sqliteRow(connection.prepare(
        "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
        "inspect-schema",
      ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
      const insert = connection.prepare(`INSERT INTO ge_cycle_cursors
        (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
         checkpoint_scope,request_scope_blob,page_size,next_position,
         snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
         schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`, "inspect-schema");
      for (let index = 1; index <= population; index += 1) {
        const reverse = population - index + 1;
        const tenant = `tenant-${reverse.toString().padStart(4, "0")}`;
        const stream = `stream-${reverse.toString().padStart(4, "0")}`;
        insert.run(
          tenant, index.toString(16).padStart(64, "0"), "event",
          "2".repeat(64), "3".repeat(64), stream, null,
          Buffer.from(`{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"${stream}"}`),
          1, 0, -1, null, descriptor, schema,
          Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
          CAPTURED_AT_MS, CAPTURED_AT_MS + 1,
        );
      }
      const beforeTempPages = Number((connection.prepare(
        "PRAGMA temp.page_count", "inspect-schema",
      ).get() as unknown as readonly [bigint])[0]);
      const run = prepareThrough("legacy", connection);
      const native = DatabaseSync.prototype as unknown as {
        prepare(sql: string): StatementSync;
      };
      const originalPrepare = native.prepare;
      let activeCursors = 0;
      let maximumActiveCursors = 0;
      let maximumFetchSize = 0;
      let sourceRowsObserved = 0;
      const eqpSql = new Set<string>();
      const normalizedEqpDetails: string[] = [];
      try {
        expect(connection.prepare(
          "SELECT token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY LIMIT 1",
          "inspect-schema",
        ).get()).toEqual([population.toString(16).padStart(64, "0")]);
        expect(connection.prepare(
          "SELECT token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY DESC, token_hash COLLATE BINARY DESC LIMIT 1",
          "inspect-schema",
        ).get()).toEqual(["1".padStart(64, "0")]);
        const oracle = new SQLiteCursorSealAccumulator(population, descriptor, schema);
        const tokenOrderedSql = SQLITE_CURSOR_MAIN_SOURCE_QUERY.replace(
          "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
          "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
        );
        for (const physicalRow of connection.prepare(
          tokenOrderedSql, "inspect-schema",
        ).iterate()) oracle.append(decodeSQLiteCursorSealRow(physicalRow));
        const receipt = mintReceipt(
          run.sourceSummary, run.projectionIdentity,
          oracle.finish(),
        );
        native.prepare = function (statementSql: string): StatementSync {
          const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
          return wrapNativeStatement(base, {
            iterate: (...parameters: never[]) => {
              const source = base.iterate(...parameters)[Symbol.iterator]();
              activeCursors += 1;
              maximumActiveCursors = Math.max(maximumActiveCursors, activeCursors);
              if (statementSql.startsWith("EXPLAIN QUERY PLAN ")) eqpSql.add(statementSql);
              let closed = false;
              const close = (): void => {
                if (closed) return;
                closed = true;
                activeCursors -= 1;
              };
              return {
                [Symbol.iterator]() { return this; },
                next: () => {
                  const next = source.next();
                  if (next.done) close();
                  else {
                    maximumFetchSize = Math.max(maximumFetchSize, 1);
                    if (statementSql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
                      sourceRowsObserved += 1;
                    }
                    if (statementSql.startsWith("EXPLAIN QUERY PLAN ")) {
                      normalizedEqpDetails.push(String(
                        (next.value as unknown as readonly unknown[])[3],
                      ).trim().replace(/\s+/gu, " ").toUpperCase());
                    }
                  }
                  return next;
                },
                return: () => {
                  close();
                  return source.return?.();
                },
              };
            },
          });
        };
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          connection, run.stage, receipt,
        );
        createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
        const campaign = new SQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer,
        );
        const outcome = campaign.run();
        native.prepare = originalPrepare;
        expect(outcome.status).toBe("pre-rebind-complete");
        if (outcome.status !== "pre-rebind-complete") throw new Error("unexpected diagnosis");
        expect(outcome.receipt).toBe(receipt);
        expect(assertSQLiteCursorPreRebindReceiptProvenance(outcome.receipt)
          .sealReceipt.immutableRootSha256).toBe(
          assertSQLiteCursorPreRebindReceiptProvenance(receipt)
            .sealReceipt.immutableRootSha256,
        );
        expect(campaign.resourceEvidence).toEqual({
          currentActiveRegisteredCursors: 0,
          currentLiveDecodedRows: 0,
          currentLiveRawRows: 0,
          currentNestedPointOperations: 0,
          currentTempObjectCount: 1,
          finalTempObjectCount: 1,
          finalTempRows: population,
          maximumActiveRegisteredCursors: 1,
          maximumFetchSize: 1,
          maximumLiveCarriers: 1,
          maximumLiveDecodedRows: 1,
          maximumLiveRawRows: 1,
          maximumNestedPointOperations: 1,
          maximumTempObjects: 1,
          maximumTempRows: population,
          tempObjectCountEvidence: "in-campaign-temp-schema-scalar",
          tempObjectMeasurements: 3,
        });
        expect(activeCursors).toBe(0);
        expect(maximumActiveCursors).toBe(1);
        expect(maximumFetchSize).toBe(1);
        expect(sourceRowsObserved).toBe(population);
        expect(eqpSql.size).toBe(15);
        expect(normalizedEqpDetails.some((detail) =>
          ["AUTOMATIC", "MATERIALIZE", "USE TEMP B-TREE", "CO-ROUTINE"]
            .some((forbidden) => detail.includes(forbidden)))).toBe(false);
        expect(connection.prepare(
          "SELECT count(*) FROM temp.ge_blr_cursor_seal", "inspect-schema",
        ).get()).toEqual([BigInt(population)]);
        const afterTempPages = Number((connection.prepare(
          "PRAGMA temp.page_count", "inspect-schema",
        ).get() as unknown as readonly [bigint])[0]);
        expect(afterTempPages).toBeGreaterThanOrEqual(beforeTempPages);
        expect(afterTempPages - beforeTempPages).toBeLessThan(population + 64);
        expect(connection.prepare(
          "SELECT count(*) FROM temp.sqlite_schema WHERE type='table' AND name='ge_blr_cursor_seal'",
          "inspect-schema",
        ).get()).toEqual([1n]);
      } finally {
        native.prepare = originalPrepare;
        cleanup(run);
      }
    },
    90_000,
  );

  it.each([0n, 2n])(
    "rejects measured cursor TEMP object inventory %s instead of publishing constant evidence",
    (forgedCount) => {
      const run = prepareThrough("legacy");
      const permanentBefore = permanentCursorDigest(run.connection);
      const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
      const originalPrepare = native.prepare;
      let intercepted = false;
      try {
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt,
        );
        createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
        native.prepare = function (sql: string): StatementSync {
          const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
          if (sql !== SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL || intercepted) return base;
          intercepted = true;
          return wrapNativeStatement(base, { get: () => [forgedCount] });
        };
        const campaign = new SQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
        expect(() => campaign.run()).toThrow(/TEMP object inventory/u);
        expect(intercepted).toBe(true);
        expect(campaign.resourceEvidence).toMatchObject({
          currentTempObjectCount: Number(forgedCount),
          finalTempObjectCount: Number(forgedCount),
          maximumTempObjects: Number(forgedCount),
          tempObjectCountEvidence: "in-campaign-temp-schema-scalar",
          tempObjectMeasurements: 1,
        });
        assertCursorFailurePostconditions(run, permanentBefore, new Error("measured inventory"));
      } finally {
        native.prepare = originalPrepare;
        cleanup(run);
      }
    },
  );

  it.each([
    {
      name: "rule 1 authorization", vectorIndex: 0,
      suffix: " [b2:authorization-malformed]",
      mutate: (values: unknown[]) => { values[3] = "bad"; },
    },
    {
      name: "rule 2 closed scope", vectorIndex: 1,
      suffix: " [b2:request-extra-key]",
      mutate: (values: unknown[]) => {
        values[7] = Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","extra":true,"pageSize":1,"streamId":"stream-1"}');
      },
    },
    {
      name: "rule 3 canonical blob", vectorIndex: 2,
      suffix: " [b2:blob-invalid-utf8]",
      mutate: (values: unknown[]) => { values[7] = Buffer.from([0xff, 0xfe]); },
    },
    {
      name: "rule 3 BOM-prefixed blob", vectorIndex: 2,
      suffix: " [b2:blob-bom]",
      mutate: (values: unknown[]) => {
        values[7] = Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]), values[7] as Buffer,
        ]);
      },
    },
    {
      name: "rule 3 duplicate-key blob", vectorIndex: 2,
      suffix: " [b2:blob-duplicate-key]",
      mutate: (values: unknown[]) => {
        values[7] = Buffer.from(
          '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"pageSize":1,"streamId":"stream-1"}',
        );
      },
    },
    {
      name: "rule 3 noncanonical-order blob", vectorIndex: 2,
      suffix: " [b2:blob-noncanonical-order]",
      mutate: (values: unknown[]) => {
        values[7] = Buffer.from(
          '{"streamId":"stream-1","pageSize":1,"contractVersion":"cycle-store-provider/v1alpha1"}',
        );
      },
    },
    {
      name: "rule 3 over-bound blob", vectorIndex: 2,
      suffix: " [b2:blob-over-bound]",
      mutate: (values: unknown[]) => { values[7] = Buffer.alloc(1_048_577, 0x20); },
    },
    {
      name: "rule 4 position", vectorIndex: 3,
      suffix: " [b2:position-beyond-snapshot]",
      mutate: (values: unknown[]) => { values[9] = 1; },
    },
    {
      name: "rule 4 zero page size", vectorIndex: 3,
      suffix: " [b2:page-zero]",
      mutate: (values: unknown[]) => { values[8] = 0; },
    },
    {
      name: "rule 4 page size 257", vectorIndex: 3,
      suffix: " [b2:page-257]",
      mutate: (values: unknown[]) => { values[8] = 257; },
    },
    {
      name: "rule 5 clock", vectorIndex: 4,
      suffix: " [b2:provider-clock-regression]",
      mutate: (values: unknown[]) => {
        values[15] = CAPTURED_AT_MS + 1;
        values[16] = CAPTURED_AT_MS + 2;
      },
    },
    {
      name: "rule 5 consumed-before-created clock", vectorIndex: 4,
      suffix: " [b2:clock-consumed-before-created]",
      mutate: (values: unknown[]) => { values[17] = Number(values[15]) - 1; },
    },
    {
      name: "rule 6 catalog binding", vectorIndex: 5,
      suffix: " [b2:descriptor-substitution]",
      mutate: (values: unknown[]) => { values[12] = "0".repeat(64); },
    },
    {
      name: "rule 6 schema substitution", vectorIndex: 5,
      suffix: " [b2:schema-substitution]",
      mutate: (values: unknown[]) => { values[13] = "0".repeat(64); },
    },
    {
      name: "rule 9 event history binding", vectorIndex: 8,
      suffix: " [b2:event-snapshot-mismatch]",
      mutate: (values: unknown[]) => {
        values[14] = Buffer.from('{"exists":true,"recordHash":null,"sequence":-1}');
      },
    },
    {
      name: "rule 9 missing retained event tail", vectorIndex: 8,
      suffix: " [b2:event-missing-retained-tail]",
      mutate: (values: unknown[]) => {
        values[10] = 0;
        values[11] = "d".repeat(64);
        values[14] = Buffer.from(
          `{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`,
        );
      },
    },
    {
      name: "rule 10 checkpoint history binding", vectorIndex: 9, suffix: "",
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [CHECKPOINT_SUMMARY]);
      },
    },
    {
      name: "rule 10 missing historical checkpoint put", vectorIndex: 9,
      suffix: " [b2:checkpoint-missing-put]",
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [CHECKPOINT_SUMMARY]);
      },
    },
    {
      name: "rule 10 ascending checkpoint sequence", vectorIndex: 9,
      suffix: " [b2:checkpoint-sequence-order]", checkpointLookups: 1,
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [
          { ...CHECKPOINT_SUMMARY, boundSequence: 5 },
          { ...CHECKPOINT_SUMMARY, boundSequence: 6, checkpointId: "cp-z" },
        ]);
      },
    },
    {
      name: "rule 10 ascending checkpoint creation time", vectorIndex: 9,
      suffix: " [b2:checkpoint-created-order]", checkpointLookups: 1,
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [
          CHECKPOINT_SUMMARY,
          { ...CHECKPOINT_SUMMARY, checkpointId: "cp-z", createdAt: "2026-07-28T00:00:01Z" },
        ]);
      },
    },
    {
      name: "rule 10 descending checkpoint id", vectorIndex: 9,
      suffix: " [b2:checkpoint-id-order]", checkpointLookups: 1,
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [
          { ...CHECKPOINT_SUMMARY, checkpointId: "cp-b" },
          { ...CHECKPOINT_SUMMARY, checkpointId: "cp-a" },
        ]);
      },
    },
  ].map((testCase) => [
    `diagnoses ${testCase.name} in isolation through the real campaign${testCase.suffix}`,
    testCase,
  ] as const))("%s", (_title, testCase) => {
    const { mutate, vectorIndex } = testCase;
    const checkpointLookups = "checkpointLookups" in testCase
      ? testCase.checkpointLookups : 0;
    const connection = openConnection();
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, mutate);
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let checkpointLookupCalls = 0;
    try {
      if (checkpointLookups > 0) {
        native.prepare = function (sql: string): StatementSync {
          const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
          if (sql !== SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL) return base;
          return wrapNativeStatement(base, {
            get: (...parameters: never[]) => {
              base.get(...parameters);
              checkpointLookupCalls += 1;
              return [1n];
            },
          });
        };
      }
      const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
        cursorCount: 1,
        immutableRootSha256: "0".repeat(64),
        sourceDescriptorHash: descriptor,
        sourceSchemaIdentitySha256: schema,
      }));
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      const expected = Array<number>(10).fill(0);
      expected[vectorIndex] = 1;
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual(expected);
      expect(outcome.diagnostics).toEqual([{
        diagnosticsTruncated: false,
        ruleId: SQLITE_CURSOR_PRE_REBIND_RULE_ORDER[vectorIndex],
        violationCount: 1,
      }]);
      expect("receipt" in outcome).toBe(false);
      expect(checkpointLookupCalls).toBe(checkpointLookups);
      expect(permanentCursorDigest(connection)).toBe(permanentBefore);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("diagnoses scope-null-group exclusively as closed-scope rule 2 [b2:scope-null-group]", () => {
    const connection = openConnection();
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[5] = null;
    });
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    try {
      const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
        cursorCount: 1,
        immutableRootSha256: "0".repeat(64),
        sourceDescriptorHash: descriptor,
        sourceSchemaIdentitySha256: schema,
      }));
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(outcome.diagnostics).toHaveLength(1);
      expect("receipt" in outcome).toBe(false);
      expect(run.stage.state).toBe("open");
      expect(permanentCursorDigest(connection)).toBe(permanentBefore);
    } finally {
      cleanup(run);
    }
  });

  it("diagnoses a representable unowned storage defect as isolated rule 8 [b2:storage-class-shape]", () => {
    const run = prepareThrough("legacy");
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const physical = cursorPhysicalValues(descriptor, schema, 1);
    physical[12] = Buffer.alloc(32);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          injected = true;
          return {
            iterate: () => [physical].values(),
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, receipt, transfer,
      );
      expect(injected).toBe(true);
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    {
      name: "authorization plus TEXT page",
      expected: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      mutate: (values: unknown[]) => {
        values[3] = "bad";
        values[8] = "1";
      },
    },
    {
      name: "checkpoint TEXT created clock plus missing put",
      expected: [0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
      mutate: (values: unknown[]) => {
        mutatePhysicalRowToCheckpoint(values, [CHECKPOINT_SUMMARY]);
        values[15] = "500";
      },
    },
    {
      name: "scope mismatch plus TEXT expiry",
      expected: [0, 1, 0, 0, 0, 0, 0, 1, 0, 0],
      mutate: (values: unknown[]) => {
        values[6] = "wrong-scope";
        values[16] = "1500";
      },
    },
    {
      name: "TEXT consumed clock plus missing retained event tail",
      expected: [0, 0, 0, 0, 0, 0, 0, 1, 1, 0],
      mutate: (values: unknown[]) => {
        values[10] = 0;
        values[11] = "d".repeat(64);
        values[14] = Buffer.from(
          `{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`,
        );
        values[17] = "600";
      },
    },
  ] as const)("preserves mixed-storage campaign diagnostics: $name", ({
    expected, mutate,
  }) => {
    const run = prepareThrough("legacy");
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const physical = cursorPhysicalValues(descriptor, schema, 1);
    mutate(physical);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          injected = true;
          return {
            iterate: () => [physical].values(),
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, receipt, transfer,
      );
      expect(injected).toBe(true);
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual(expected);
      expect(outcome.diagnostics.map(({ ruleId, violationCount }) => ({
        ruleId, violationCount,
      }))).toEqual(expected.flatMap((count, index) => count === 0 ? [] : [{
        ruleId: SQLITE_CURSOR_PRE_REBIND_RULE_ORDER[index], violationCount: count,
      }]));
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("aggregates all ten rules in registry order without publishing authority [b2:all-rules-nonlexical-input]", () => {
    const run = prepareThrough("legacy");
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const rule10 = (values: unknown[]): void => {
        values[2] = "checkpoint";
        values[5] = null;
        values[6] = "checkpoint-scope";
        values[7] = Buffer.from('{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":1}');
        values[9] = 1;
        values[10] = null;
        values[11] = null;
        values[14] = Buffer.from('[{"boundRecordHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","boundSequence":6,"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","createdAt":"2026-07-28T00:00:00Z","streamId":"stream-alpha","valueBytes":2,"valueHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]');
    };
    const groups: readonly Readonly<{
      count: number;
      mutate(values: unknown[]): void;
    }>[] = [
      { count: 10, mutate: rule10 },
      { count: 3, mutate: (values) => { values[7] = Buffer.from([0xff, 0xfe]); } },
      { count: 8, mutate: (values) => { values[12] = Buffer.alloc(32); } },
      { count: 1, mutate: (values) => { values[3] = "bad"; } },
      { count: 6, mutate: (values) => { values[12] = "0".repeat(64); } },
      { count: 2, mutate: (values) => {
        const streamId = String(values[5]);
        values[7] = Buffer.from(`{"contractVersion":"cycle-store-provider/v1alpha1","extra":true,"pageSize":1,"streamId":"${streamId}"}`);
      } },
      { count: 9, mutate: (values) => {
        values[14] = Buffer.from('{"exists":true,"recordHash":null,"sequence":-1}');
      } },
      { count: 4, mutate: (values) => { values[9] = 1; } },
      { count: 5, mutate: (values) => {
        values[15] = CAPTURED_AT_MS + 1;
        values[16] = CAPTURED_AT_MS + 2;
      } },
    ];
    const physicalRows: unknown[][] = [];
    let ordinal = 0;
    for (const group of groups) {
      for (let index = 0; index < group.count; index += 1) {
        ordinal += 1;
        const values = cursorPhysicalValues(descriptor, schema, ordinal);
        group.mutate(values);
        physicalRows.push(values);
      }
    }
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: physicalRows.length - 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (!injected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          injected = true;
          return {
            iterate: () => physicalRows.values(),
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, receipt, transfer,
      );
      const outcome = campaign.run();
      expect(injected).toBe(true);
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([1, 2, 3, 4, 5, 6, 1, 8, 9, 10]);
      expect(outcome.diagnostics.map(({ ruleId }) => ruleId)).toEqual([
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
      ]);
      expect("receipt" in outcome).toBe(false);
      expect(JSON.stringify(outcome)).not.toMatch(/immutableRoot|sourceDescriptor/u);
      expect(() => campaign.run()).toThrow(/one-shot/u);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { caseId: "later-event-append-allowed" },
    { caseId: "later-current-checkpoint-mutation-allowed" },
  ].map((testCase) => [
    `accepts later mutation ${testCase.caseId} [b2:${testCase.caseId}]`, testCase,
  ] as const))("%s", async (_title, { caseId }) => {
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-cursor-cross-order-"));
    roots.push(root);
    const path = join(root, "cycle-store.db");
    const now = CAPTURED_AT_MS;
    const provider = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    const eventAuth = Object.freeze({
      tenantId: "tenant-z", principalHash: "a".repeat(64), authorizationHash: "b".repeat(64),
    });
    const checkpointAuth = Object.freeze({
      tenantId: "tenant-a", principalHash: "c".repeat(64), authorizationHash: "d".repeat(64),
    });
    const expectedKind = caseId === "later-event-append-allowed" ? "event" : "checkpoint";
    try {
      if (caseId === "later-event-append-allowed") {
      const firstEvent = createCycleStoreRecord({
        recordId: "event-0", sequence: 0, previousRecordHash: null, value: { sequence: 0 },
      });
      const eventRecords = [firstEvent, createCycleStoreRecord({
        recordId: "event-1", sequence: 1,
        previousRecordHash: firstEvent.recordHash, value: { sequence: 1 },
      })];
      await provider.append({
        context: { ...eventAuth, operationId: "append-event" }, streamId: "stream-z",
        expectedTail: { exists: false, sequence: -1, recordHash: null },
        lease: null, records: eventRecords,
      });
      await provider.readEventPage({
        context: eventAuth, streamId: "stream-z", fromSequence: 0, pageSize: 1, cursor: null,
      });
      const laterEvent = createCycleStoreRecord({
        recordId: "event-2", sequence: 2,
        previousRecordHash: eventRecords[1]!.recordHash, value: { sequence: 2 },
      });
      await provider.append({
        context: { ...eventAuth, operationId: "append-event-later" }, streamId: "stream-z",
        expectedTail: {
          exists: true, sequence: 1, recordHash: eventRecords[1]!.recordHash,
        },
        lease: null, records: [laterEvent],
      });
      } else {
      const bound = createCycleStoreRecord({
        recordId: "checkpoint-record", sequence: 0, previousRecordHash: null, value: 1,
      });
      await provider.append({
        context: { ...checkpointAuth, operationId: "append-checkpoint" }, streamId: "stream-a",
        expectedTail: { exists: false, sequence: -1, recordHash: null },
        lease: null, records: [bound],
      });
      let cpAValueHash = "";
      for (const [index, id] of ["cp-a", "cp-b"].entries()) {
        const checkpoint = createCycleStoreCheckpoint({
          checkpointScope: "scope-a", checkpointId: id, streamId: "stream-a",
          boundSequence: 0, boundRecordHash: bound.recordHash,
          createdAt: `2026-07-28T00:00:0${index}Z`, value: { index },
        });
        await provider.saveCheckpoint({
          context: { ...checkpointAuth, operationId: `save-${id}` }, checkpoint, lease: null,
        });
        if (id === "cp-a") cpAValueHash = checkpoint.valueHash;
      }
      await provider.listCheckpoints({
        context: checkpointAuth, checkpointScope: "scope-a", pageSize: 1, cursor: null,
      });
      const laterCheckpoint = createCycleStoreCheckpoint({
        checkpointScope: "scope-a", checkpointId: "cp-a", streamId: "stream-a",
        boundSequence: 0, boundRecordHash: bound.recordHash,
        createdAt: "2026-07-28T00:00:09Z", value: { index: 9 },
      });
      await provider.deleteCheckpoint({
        context: { ...checkpointAuth, operationId: "delete-cp-a-later" },
        checkpointScope: "scope-a", checkpointId: "cp-a", expectedValueHash: cpAValueHash,
      });
      await provider.saveCheckpoint({
        context: { ...checkpointAuth, operationId: "save-cp-a-later" },
        checkpoint: laterCheckpoint, lease: null,
      });
      }
    } finally {
      provider.close();
    }

    const connection = new SQLiteConnection(path);
    configureSQLiteBaselineTempStorage(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const run = prepareThrough("legacy", connection);
    try {
      const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
      const descriptor = witness.sealReceipt.sourceDescriptorHash;
      const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
      const physicalRows = [...connection.prepare(
        SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
      ).iterate()];
      expect(physicalRows.map((row) => (row as readonly unknown[])[2]))
        .toEqual([expectedKind]);
      const actualSeal = sealSQLiteCursorRows(
        1, descriptor, schema, physicalRows.map(decodeSQLiteCursorSealRow)
          .sort((left, right) => Buffer.compare(
            Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash),
          ) || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId))),
      );
      const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, actualSeal);
      const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, run.stage, receipt);
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(connection.prepare(
        "SELECT kind FROM temp.ge_blr_cursor_seal ORDER BY token_hash,tenant_id",
        "inspect-schema",
      ).all()).toEqual([[expectedKind]]);
    } finally {
      cleanup(run);
    }
  });

  it("completes a nonempty B2 campaign on the real alpha-v0 migration lineage", () => {
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-cursor-alpha-lineage-"));
    roots.push(root);
    const connection = new SQLiteConnection(join(root, "cycle-store.db"));
    connection.execTrusted(readFileSync(
      new URL("../../../spec/migrations/sqlite/fixtures/alpha-v0.sql", import.meta.url),
      "utf8",
    ), "inspect-schema");
    expect(ensureSQLiteCycleStoreSchema(
      connection, createSQLiteCycleStoreDescriptor(), { appliedAtMs: CAPTURED_AT_MS },
    )).toMatchObject({ disposition: "migrated", lineageId: "alpha-v0-to-v1" });
    configureSQLiteBaselineTempStorage(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    try {
      const rows = connection.prepare(
        SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
      ).all();
      const seal = sealSQLiteCursorRows(
        1, descriptor, schema, rows.map(decodeSQLiteCursorSealRow),
      );
      const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, seal);
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
      );
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(outcome.status === "pre-rebind-complete" && outcome.receipt).toBe(receipt);
      expect(connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_cursor_seal", "inspect-schema",
      ).get()).toEqual([1n]);
    } finally {
      cleanup(run);
    }
  });

  it("checks exact authority before options and supports closed cancellation [b2:cancel-at-begin]", () => {
    const authorityRun = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        authorityRun.connection, authorityRun.stage, authorityRun.receipt,
      );
      createSQLiteCursorSealTempTable(
        authorityRun.connection, authorityRun.stage, authorityRun.receipt, transfer,
      );
      expect(() => new SQLiteCursorPreRebindCampaign(
        authorityRun.connection, authorityRun.stage, authorityRun.receipt,
        Object.freeze(Object.create(null)) as SQLiteCursorStageOwnershipTransfer,
        { diagnosticLimit: 0 },
      )).toThrow(/authority/u);
    } finally {
      cleanup(authorityRun);
    }

    const cancelledRun = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        cancelledRun.connection, cancelledRun.stage, cancelledRun.receipt,
      );
      createSQLiteCursorSealTempTable(
        cancelledRun.connection, cancelledRun.stage, cancelledRun.receipt, transfer,
      );
      const controller = createSQLiteCursorPreRebindCancellationController();
      controller.cancel();
      expect(() => runSQLiteCursorPreRebindCampaign(
        cancelledRun.connection, cancelledRun.stage, cancelledRun.receipt, transfer,
        { cancellation: controller.signal },
      )).toThrow(/cancelled/u);
      expect(cancelledRun.stage.state).toBe("poisoned");
    } finally {
      cleanup(cancelledRun);
    }
  });

  it.each(CLOSED_CAMPAIGN_BOUNDARY_CASES.map((testCase) => [
    `fails closed at deterministic campaign boundary ${testCase.label} [b2:${testCase.caseId}] [variant:${testCase.label}]`,
    testCase,
  ] as const))(
    "%s",
    (_title, { label }) => {
      const run = prepareThrough("legacy");
      const permanentBefore = permanentCursorDigest(run.connection);
      let observed: unknown;
      try {
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt,
        );
        createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
        const controller = createSQLiteCursorPreRebindLabelCancellationController(label);
        try {
          runSQLiteCursorPreRebindCampaign(
            run.connection, run.stage, run.receipt, transfer,
            { cancellation: controller.signal },
          );
        } catch (error) {
          observed = error;
        }
        expect(observed, label).toBeInstanceOf(Error);
        expect(String((observed as Error).message), label).toMatch(/cancelled/u);
        expect(run.stage.state, label).toBe("poisoned");
        assertCursorFailurePostconditions(run, permanentBefore, observed);
      } finally {
        cleanup(run);
      }
    },
  );

  it.each([
    "source:before-inspect",
    "source:after-inspect",
    "stage-insert:before-execute",
    "stage-insert:after-execute",
  ])("fails closed at row boundary %s", (label) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const controller = createSQLiteCursorPreRebindLabelCancellationController(label);
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed, label).toBeInstanceOf(Error);
      expect(String((observed as Error).message), label).toMatch(/cancelled/u);
      expect(run.stage.state, label).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    "event-lookup:before-get",
    "event-lookup:after-get",
  ])("fails closed at nonempty event lookup boundary %s", (label) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[10] = 0;
      values[11] = "d".repeat(64);
      values[14] = Buffer.from(`{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`);
    });
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, run.stage, receipt);
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const controller = createSQLiteCursorPreRebindLabelCancellationController(label);
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed, label).toBeInstanceOf(Error);
      expect(String((observed as Error).message), label).toMatch(/cancelled/u);
      expect(run.stage.state, label).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    "checkpoint-lookup:before-get",
    "checkpoint-lookup:after-get",
  ])("fails closed at nonempty checkpoint lookup boundary %s", (label) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[2] = "checkpoint";
      values[5] = null;
      values[6] = "checkpoint-scope";
      values[7] = Buffer.from('{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":1}');
      values[9] = 1;
      values[10] = null;
      values[11] = null;
      values[14] = Buffer.from('[{"boundRecordHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","boundSequence":6,"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","createdAt":"2026-07-28T00:00:00Z","streamId":"stream-alpha","valueBytes":2,"valueHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]');
    });
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, run.stage, receipt);
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const controller = createSQLiteCursorPreRebindLabelCancellationController(label);
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed, label).toBeInstanceOf(Error);
      expect(String((observed as Error).message), label).toMatch(/cancelled/u);
      expect(run.stage.state, label).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    { kind: "event", marker: [] },
    { kind: "event", marker: [1, 1] },
    { kind: "event", marker: [0] },
    { kind: "event", marker: ["1"] },
    { kind: "checkpoint", marker: [] },
    { kind: "checkpoint", marker: [1, 1] },
    { kind: "checkpoint", marker: [0] },
    { kind: "checkpoint", marker: ["1"] },
  ] as const)("keeps malformed $kind lookup marker authoritative over cancellation: $marker", ({
    kind, marker,
  }) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      if (kind === "event") {
        values[10] = 0;
        values[11] = "d".repeat(64);
        values[14] = Buffer.from(`{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`);
      } else {
        values[2] = "checkpoint";
        values[5] = null;
        values[6] = "checkpoint-scope";
        values[7] = Buffer.from('{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":1}');
        values[9] = 1;
        values[10] = null;
        values[11] = null;
        values[14] = Buffer.from('[{"boundRecordHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","boundSequence":6,"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","createdAt":"2026-07-28T00:00:00Z","streamId":"stream-alpha","valueBytes":2,"valueHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]');
      }
    });
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const controller = createSQLiteCursorPreRebindCancellationController();
    const target = kind === "event"
      ? SQLITE_CURSOR_EVENT_LOOKUP_SQL : SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL;
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== target) return base;
        return wrapNativeStatement(base, { get: () => {
          controller.cancel();
          return marker;
        } });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, run.stage, receipt);
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({ message: expect.stringMatching(/lookup marker/u) });
      expect(String((observed as Error).message)).not.toMatch(/cancelled/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("fails closed at the diagnosed publication boundary [b2:cancel-before-complete] [variant:diagnosed-publication]", () => {
    const connection = openConnection();
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[3] = "bad";
    });
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, run.stage, receipt);
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const controller = createSQLiteCursorPreRebindLabelCancellationController(
        "publish:diagnosed",
      );
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect(String((observed as Error).message)).toMatch(/cancelled/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it("targets a repeated boundary occurrence without retaining a trace", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const controller = createSQLiteCursorPreRebindLabelCancellationController(
        "source:before-fetch", 2,
      );
      try {
        runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer, { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect(String((observed as Error).message)).toMatch(/cancelled/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    { label: "plan:source:after-prepare", sql: `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}` },
    { label: "source:after-prepare", sql: SQLITE_CURSOR_MAIN_SOURCE_QUERY },
    { label: "rule:BLR_CURSOR_AUTHORIZATION:after-prepare", sql: SQLITE_CURSOR_ROW_RULES[0]!.sql },
    { label: "seal:after-prepare", sql: SQLITE_CURSOR_STAGE_SEAL_SQL },
  ])("closes exactly once when cancellation lands at $label", ({ label, sql }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const controller = createSQLiteCursorPreRebindLabelCancellationController(label);
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let closeCalls = 0;
    let observed: unknown;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
        if (statementSql !== sql) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => source.next(),
              return: () => {
                closeCalls += 1;
                return source.return?.();
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
          { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({ message: expect.stringMatching(/cancelled/u) });
      expect(closeCalls).toBe(1);
      assertCursorFailurePostconditions(run, permanentBefore, observed);
      expect(closeCalls).toBe(1);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
      expect(closeCalls).toBe(1);
    }
  });

  it("accounts a cancelled EQP cursor as one registered owner and closes it exactly once", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const controller = createSQLiteCursorPreRebindLabelCancellationController(
      "plan:source:after-prepare",
    );
    let campaign: SQLiteCursorPreRebindCampaign | undefined;
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
        { cancellation: controller.signal },
      );
      try {
        campaign.run();
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({ message: expect.stringMatching(/cancelled/u) });
      expect(campaign.resourceEvidence).toMatchObject({
        currentActiveRegisteredCursors: 0,
        maximumActiveRegisteredCursors: 1,
      });
      expect(campaign.queryPlanEvidence).toEqual([]);
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it("polls cancellation around EQP, source, insert, rule, and seal work", () => {
    for (const checkpoint of ["eqp", "source", "insert", "rule", "seal"] as const) {
      const connection = openConnection();
      let descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
      let schema = "";
      if (checkpoint === "source" || checkpoint === "insert") {
        [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
      }
      const run = prepareThrough("legacy", connection);
      const permanentBefore = permanentCursorDigest(connection);
      const receipt = checkpoint === "source" || checkpoint === "insert"
        ? mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
          cursorCount: 1,
          immutableRootSha256: "0".repeat(64),
          sourceDescriptorHash: descriptor,
          sourceSchemaIdentitySha256: schema,
        }))
        : run.receipt;
      const controller = createSQLiteCursorPreRebindCancellationController();
      const native = DatabaseSync.prototype as unknown as {
        prepare(sql: string): StatementSync;
      };
      const originalPrepare = native.prepare;
      const target = checkpoint === "eqp" ? `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}`
        : checkpoint === "source" ? SQLITE_CURSOR_MAIN_SOURCE_QUERY
        : checkpoint === "insert" ? SQLITE_CURSOR_STAGE_INSERT_SQL
          : checkpoint === "rule" ? SQLITE_CURSOR_ROW_RULES[0]!.sql
            : SQLITE_CURSOR_STAGE_SEAL_SQL;
      let injected = false;
      try {
        native.prepare = function (sql: string): StatementSync {
          const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
          if (injected || sql !== target) return base;
          injected = true;
          if (checkpoint === "insert") {
            return wrapNativeStatement(base, {
              run: (...parameters: never[]) => {
                const result = base.run(...parameters);
                controller.cancel();
                return result;
              },
            });
          }
          return wrapNativeStatement(base, {
            iterate: (...parameters: never[]) => {
              const source = base.iterate(...parameters)[Symbol.iterator]();
              return {
                [Symbol.iterator]() { return this; },
                next: () => {
                  const next = source.next();
                  controller.cancel();
                  return next;
                },
                return: () => source.return?.(),
              };
            },
          });
        };
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          connection, run.stage, receipt,
        );
        createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
        expect(() => runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer,
          { cancellation: controller.signal },
        ), checkpoint).toThrow(/cancelled/u);
        expect(injected, checkpoint).toBe(true);
        expect(run.stage.state, checkpoint).toBe("poisoned");
        assertCursorFailurePostconditions(run, permanentBefore, undefined);
      } finally {
        native.prepare = originalPrepare;
        cleanup(run);
      }
    }
  });

  it.each([
    {
      name: "malformed EQP row",
      sql: `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}`,
      expected: /query plan row/u,
      throws: false,
    },
    {
      name: "malformed rule marker",
      sql: SQLITE_CURSOR_ROW_RULES[0]!.sql,
      expected: /cursor rule marker/u,
      throws: false,
    },
    {
      name: "source fetch primary",
      sql: SQLITE_CURSOR_MAIN_SOURCE_QUERY,
      expected: /authoritative combined fetch failure/u,
      throws: true,
    },
  ] as const)("keeps $name authoritative over simultaneous cancellation", ({
    expected, sql, throws,
  }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const controller = createSQLiteCursorPreRebindCancellationController();
    const primary = new Error("authoritative combined fetch failure");
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let observed: unknown;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
        if (statementSql !== sql) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            let first = true;
            return {
              [Symbol.iterator]() { return this; },
              next: () => {
                if (!first) return source.next();
                first = false;
                controller.cancel();
                if (throws) throw primary;
                return { done: false, value: [] };
              },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
          { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      if (throws) expect(observed).toBe(primary);
      else expect(observed).toMatchObject({ message: expect.stringMatching(expected) });
      expect(String((observed as Error).message)).not.toMatch(/cancelled/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("polls cancellation after an event-history lookup", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[10] = 0;
      values[11] = "d".repeat(64);
      values[14] = Buffer.from(`{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`);
    });
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const controller = createSQLiteCursorPreRebindCancellationController();
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    const lookupSql = "SELECT 1 AS binding_marker FROM main.ge_cycle_records INDEXED BY ge_cycle_records_stream_sequence_hash_uq WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ? LIMIT 1";
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== lookupSql) return base;
        return wrapNativeStatement(base, {
          get: (...parameters: never[]) => {
            const result = base.get(...parameters);
            injected = true;
            controller.cancel();
            return result;
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      expect(() => runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
        { cancellation: controller.signal },
      )).toThrow(/cancelled/u);
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, undefined);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    ["polls cancellation before diagnosed publication", 3, true],
    [
      "polls cancellation before clean publication "
        + "[b2:cancel-before-complete] [variant:clean-publication]",
      4,
      false,
    ],
  ] as const)("%s", (_title, identityRead, diagnosed) => {
    const connection = openConnection();
    let descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    let schema = "";
    if (diagnosed) {
      connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
      [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
        values[3] = "bad";
      });
      connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    }
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = diagnosed
      ? mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
        cursorCount: 1,
        immutableRootSha256: "0".repeat(64),
        sourceDescriptorHash: descriptor,
        sourceSchemaIdentitySha256: schema,
      }))
      : run.receipt;
    const controller = createSQLiteCursorPreRebindCancellationController();
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const identitySql = "SELECT provider_descriptor_hash,schema_identity_sha256 "
      + "FROM main.ge_cycle_schema WHERE singleton = 1";
    let reads = 0;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== identitySql) return base;
        return wrapNativeStatement(base, {
          get: (...parameters: never[]) => {
            const value = base.get(...parameters);
            reads += 1;
            if (reads === identityRead) controller.cancel();
            return value;
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      expect(() => runSQLiteCursorPreRebindCampaign(
        connection, run.stage, receipt, transfer,
        { cancellation: controller.signal },
      )).toThrow(/cancelled/u);
      expect(reads).toBe(identityRead);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, undefined);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    ...SQLITE_CURSOR_ROW_RULES.map(({ ruleId, sql }) => ({ name: ruleId, sql })),
    { name: "BLR_CURSOR_SEAL_COUNT", sql: SQLITE_CURSOR_COUNT_MARKER_SQL },
  ].map((testCase) => [
    `polls cancellation at rule transition ${testCase.name} [b2:cancel-at-rule] [variant:${testCase.name}-transition]`,
    testCase,
  ] as const))("%s", (_title, { sql }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const controller = createSQLiteCursorPreRebindCancellationController();
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
        if (statementSql !== sql) return base;
        injected = true;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => {
                const next = source.next();
                controller.cancel();
                return next;
              },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      expect(() => runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
        { cancellation: controller.signal },
      )).toThrow(/cancelled/u);
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, undefined);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a write mutation between consecutive rule transitions [b2:rule-transition-mutation]", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const changesBefore = totalChanges(run.connection);
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    const firstRuleSql = SQLITE_CURSOR_ROW_RULES[0]!.sql;
    let injected = false;
    let observed: unknown;
    let outcome: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== firstRuleSql) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => source.next(),
              return: () => {
                const closed = source.return?.() ?? { done: true as const, value: undefined };
                if (!injected) {
                  injected = true;
                  run.connection.prepare(
                    "UPDATE main.ge_cycle_schema SET schema_identity_sha256 = "
                      + "schema_identity_sha256 WHERE singleton = 1",
                    "inspect-schema",
                  ).run();
                }
                return closed;
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        outcome = runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(totalChanges(run.connection)).toBe(changesBefore + 1);
      expect(outcome).toBeUndefined();
      expect(observed).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        message: expect.stringMatching(/unexplained write/u),
      });
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    {
      case: "active-dispose",
      code: "GE_CYCLE_STORE_CORRUPTION",
      message: "SQLite cursor pre-rebind campaign session is invalid",
    },
    {
      case: "transaction-end",
      code: "GE_CYCLE_STORE_CORRUPTION",
      message: "SQLite baseline TEMP stage transaction changed",
    },
    {
      case: "rollback-rebegin",
      code: "GE_CYCLE_STORE_CORRUPTION",
      message: "SQLite baseline TEMP stage transaction changed",
    },
    {
      case: "closed-connection",
      code: "GE_CYCLE_STORE_UNAVAILABLE",
      message: "SQLite provider is closed",
    },
  ].map((testCase) => [
    `fails closed on ${testCase.case} during an active source fetch [b2:${testCase.case}]`,
    testCase,
  ] as const))("%s", (_title, {
    case: hostility, code, message,
  }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    let injected = false;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== SQLITE_CURSOR_MAIN_SOURCE_QUERY) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => {
                const next = source.next();
                if (!injected) {
                  injected = true;
                  if (hostility === "active-dispose") run.stage.dispose();
                  else if (hostility === "closed-connection") run.connection.close();
                  else {
                    run.connection.execTrusted("ROLLBACK", "inspect-schema");
                    if (hostility === "rollback-rebegin") {
                      run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
                    }
                  }
                }
                return next;
              },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(observed).toMatchObject({ code, message });
      expect(run.stage.state).toBe(hostility === "active-dispose" ? "disposed" : "poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a cloned receipt before touching the valid B1 authority [b2:receipt-clone]", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const clone = Object.freeze({ ...run.receipt }) as SQLiteCursorPreRebindReceipt;
      expect(() => new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, clone, transfer,
      )).toThrow(/receipt provenance/u);
      const outcome = runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      expect(outcome.status).toBe("pre-rebind-complete");
      if (outcome.status !== "pre-rebind-complete") throw new Error("unexpected diagnosis");
      expect(outcome.receipt).toBe(run.receipt);
    } finally {
      cleanup(run);
    }
  });

  it.each([
    { name: "row arity", caseId: "marker-malformed-arity", marker: [],
      sql: SQLITE_CURSOR_ROW_RULES[0]!.sql },
    { name: "row storage", caseId: "marker-malformed-type", marker: ["1"],
      sql: SQLITE_CURSOR_ROW_RULES[0]!.sql },
    { name: "row value", caseId: "marker-malformed-value", marker: [0n],
      sql: SQLITE_CURSOR_ROW_RULES[0]!.sql },
    { name: "count arity", caseId: "marker-malformed-arity", marker: [],
      sql: SQLITE_CURSOR_COUNT_MARKER_SQL },
    { name: "count storage", caseId: "marker-malformed-type", marker: ["1"],
      sql: SQLITE_CURSOR_COUNT_MARKER_SQL },
    { name: "count value", caseId: "marker-malformed-value", marker: [0n],
      sql: SQLITE_CURSOR_COUNT_MARKER_SQL },
  ].map((testCase) => [
    `rejects malformed rule marker ${testCase.name} [b2:${testCase.caseId}] [variant:${testCase.name}]`,
    testCase,
  ] as const))("%s", (_title, {
    marker, sql: target,
  }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== target) return base;
        injected = true;
        return wrapNativeStatement(base, {
          iterate: () => [marker].values(),
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      let observed: unknown;
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        message: expect.stringMatching(/cursor rule marker/u),
      });
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a post-diagnostic mutation before diagnosed publication [b2:post-diagnostic-mutation]", () => {
    const connection = openConnection();
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
      values[3] = "bad";
    });
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const target = SQLITE_CURSOR_ROW_RULES.at(-1)!.sql;
    let injected = false;
    let observed: unknown;
    let outcome: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== target) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => source.next(),
              return: () => {
                source.return?.();
                if (!injected) {
                  injected = true;
                  connection.prepare(
                    "UPDATE main.ge_cycle_cursors SET expires_at_ms = expires_at_ms",
                    "inspect-schema",
                  ).run();
                }
                return { done: true as const, value: undefined };
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        outcome = runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(outcome).toBeUndefined();
      expect(observed).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
      expect(String((observed as Error).message)).toMatch(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects mutation after the final staged row and before inventory count [b2:post-source-pre-barrier-mutation]", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let observed: unknown;
    let outcome: unknown;
    let injected = false;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== SQLITE_CURSOR_MAIN_SOURCE_QUERY) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => source.next(),
              return: () => {
                source.return?.();
                if (!injected) {
                  injected = true;
                  connection.prepare(
                    "UPDATE main.ge_cycle_cursors SET expires_at_ms = expires_at_ms",
                    "inspect-schema",
                  ).run();
                }
                return { done: true as const, value: undefined };
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        outcome = runSQLiteCursorPreRebindCampaign(
          connection, run.stage, receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(outcome).toBeUndefined();
      expect(observed).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        message: expect.stringMatching(/unexplained write/u),
      });
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a physical TEMP row count that drifts from the exact successful insert count", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let spoofed = false;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== "SELECT count(*) FROM temp.ge_blr_cursor_seal") return base;
        return wrapNativeStatement(base, {
          get: (...parameters: never[]) => {
            const row = base.get(...parameters) as unknown as readonly [bigint];
            spoofed = true;
            return [row[0] + 1n];
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(spoofed).toBe(true);
      expect(observed).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        message: expect.stringMatching(/TEMP insert inventory/u),
      });
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("makes a source close failure authoritative after clearing cleanup ownership [b2:source-close-failure]", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const primary = new Error("authoritative source close failure");
    let closeCalls = 0;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          const iterator = {
            [Symbol.iterator]() { return this; },
            next: () => ({ done: true, value: undefined }),
            return: () => {
              closeCalls += 1;
              throw primary;
            },
          };
          return {
            iterate: () => iterator,
            setAllowBareNamedParameters: () => undefined,
            setAllowUnknownNamedParameters: () => undefined,
            setReadBigInts: () => undefined,
            setReturnArrays: () => undefined,
          } as unknown as StatementSync;
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(closeCalls).toBe(1);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
      expect(closeCalls).toBe(1);
    }
  });

  it.each([
    { name: "EQP fetch", sql: `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}`, method: "iterate", row: "empty" },
    { name: "source fetch", sql: SQLITE_CURSOR_MAIN_SOURCE_QUERY, method: "iterate", row: "event-empty" },
    { name: "lookup", sql: "event-lookup", method: "get", row: "event-tail" },
    { name: "insert", sql: SQLITE_CURSOR_STAGE_INSERT_SQL, method: "run", row: "event-empty" },
    { name: "rule fetch", sql: "row-rule", method: "iterate", row: "empty" },
    { name: "seal fetch", sql: SQLITE_CURSOR_STAGE_SEAL_SQL, method: "iterate", row: "empty" },
  ] as const)("preserves the authoritative $name failure and poisons the campaign", ({
    method, name, row, sql,
  }) => {
    const connection = openConnection();
    let descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    let schema = "";
    if (row !== "empty") {
      [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
        if (row === "event-tail") {
          values[10] = 0;
          values[11] = "d".repeat(64);
          values[14] = Buffer.from(`{"exists":true,"recordHash":"${"d".repeat(64)}","sequence":0}`);
        }
      });
    }
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = row === "empty" ? run.receipt
      : mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
        cursorCount: 1,
        immutableRootSha256: "0".repeat(64),
        sourceDescriptorHash: descriptor,
        sourceSchemaIdentitySha256: schema,
      }));
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const target = sql === "event-lookup"
      ? "SELECT 1 AS binding_marker FROM main.ge_cycle_records INDEXED BY ge_cycle_records_stream_sequence_hash_uq WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ? LIMIT 1"
      : sql === "row-rule" ? SQLITE_CURSOR_ROW_RULES[0]!.sql : sql;
    const primary = new Error(`authoritative ${name} failure`);
    let injected = false;
    let observed: unknown;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
        if (injected || statementSql !== target) return base;
        injected = true;
        if (method === "get") {
          return wrapNativeStatement(base, { get: () => { throw primary; } });
        }
        if (method === "run") {
          return wrapNativeStatement(base, { run: () => { throw primary; } });
        }
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => { throw primary; },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(observed).toBe(primary);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { name: "EQP", sql: `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}`, suffix: "" },
    { name: "source", sql: SQLITE_CURSOR_MAIN_SOURCE_QUERY,
      suffix: " [b2:source-prepare-failure]" },
    { name: "lookup", sql: "SELECT 1 AS binding_marker FROM main.ge_cycle_records INDEXED BY ge_cycle_records_stream_sequence_hash_uq WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ? LIMIT 1", suffix: "" },
    { name: "insert", sql: SQLITE_CURSOR_STAGE_INSERT_SQL, suffix: "" },
    { name: "rule", sql: SQLITE_CURSOR_ROW_RULES[0]!.sql, suffix: "" },
    { name: "seal", sql: SQLITE_CURSOR_STAGE_SEAL_SQL, suffix: "" },
  ])("poisons when $name statement preparation fails$suffix", ({ sql }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_INTERNAL", "inspect-schema", "injected native prepare failure",
    );
    let injected = false;
    let observed: unknown;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        if (!injected && statementSql === sql) {
          injected = true;
          throw primary;
        }
        return Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("preserves a source-fetch primary when registered cleanup close also fails [b2:primary-plus-cleanup]", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const primary = new Error("authoritative source fetch failure");
    let closeCalls = 0;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== SQLITE_CURSOR_MAIN_SOURCE_QUERY) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => { throw primary; },
              return: () => {
                closeCalls += 1;
                source.return?.();
                throw new Error("secondary close failure");
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(closeCalls).toBe(1);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { name: "EQP", sql: `EXPLAIN QUERY PLAN ${SQLITE_CURSOR_MAIN_SOURCE_QUERY}` },
    { name: "rule", sql: SQLITE_CURSOR_ROW_RULES[0]!.sql },
    { name: "seal", sql: SQLITE_CURSOR_STAGE_SEAL_SQL },
  ].map((testCase) => [
    `treats the sole ${testCase.name} close failure as primary [b2:cleanup-only-failure] [variant:${testCase.name}]`,
    testCase,
  ] as const))("%s", (_title, { name, sql }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const primary = new Error(`authoritative ${name} close failure`);
    let closeCalls = 0;
    let observed: unknown;
    let injected = false;
    try {
      native.prepare = function (statementSql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [statementSql]) as StatementSync;
        if (injected || statementSql !== sql) return base;
        injected = true;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => source.next(),
              return: () => {
                closeCalls += 1;
                source.return?.();
                throw primary;
              },
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(observed).toBe(primary);
      expect(closeCalls).toBe(1);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
      expect(closeCalls).toBe(1);
    }
  });

  it.each([
    { name: "first", faultAt: 1, suffix: " [b2:source-first-fetch-failure]" },
    { name: "middle", faultAt: 2, suffix: " [b2:source-middle-fetch-failure]" },
    { name: "final", faultAt: 3, suffix: " [b2:source-final-fetch-failure]" },
    { name: "terminal", faultAt: 4, suffix: "" },
  ])("poisons on the $name source fetch$suffix", ({ faultAt }) => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const rows = [1, 2, 3].map((ordinal) =>
      cursorPhysicalValues(descriptor, schema, ordinal));
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 3,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    const primary = new Error(`source fetch ${faultAt}`);
    let fetches = 0;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (sql !== SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        }
        const source = rows.values();
        return {
          iterate: () => ({
            [Symbol.iterator]() { return this; },
            next: () => {
              fetches += 1;
              if (fetches === faultAt) throw primary;
              return source.next();
            },
            return: () => source.return?.(),
          }),
          setAllowBareNamedParameters: () => undefined,
          setAllowUnknownNamedParameters: () => undefined,
          setReadBigInts: () => undefined,
          setReturnArrays: () => undefined,
        } as unknown as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(run.connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(fetches).toBe(faultAt);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { name: "first", faultAt: 1 },
    { name: "middle", faultAt: 2 },
    { name: "final", faultAt: 3 },
    { name: "terminal", faultAt: 4 },
  ])("poisons on the $name seal fetch", ({ faultAt }) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined, 1);
    insertCursorPhysicalRow(connection, () => undefined, 2);
    insertCursorPhysicalRow(connection, () => undefined, 3);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const rows = [...connection.prepare(
      SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
    ).iterate()].map(decodeSQLiteCursorSealRow).sort((left, right) =>
      Buffer.compare(Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash))
        || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
    const receipt = mintReceipt(
      run.sourceSummary, run.projectionIdentity,
      sealSQLiteCursorRows(3, descriptor, schema, rows),
    );
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    const primary = new Error(`seal fetch ${faultAt}`);
    let fetches = 0;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== SQLITE_CURSOR_STAGE_SEAL_SQL) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => {
                fetches += 1;
                if (fetches === faultAt) throw primary;
                return source.next();
              },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(fetches).toBe(faultAt);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { name: "first", faultAt: 1 },
    { name: "middle", faultAt: 2 },
    { name: "final", faultAt: 3 },
    { name: "terminal", faultAt: 4 },
  ])("poisons on the $name rule-marker fetch", ({ faultAt }) => {
    const connection = openConnection();
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    let descriptor = "";
    let schema = "";
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      [descriptor, schema] = insertCursorPhysicalRow(connection, (values) => {
        values[3] = "bad";
      }, ordinal);
    }
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 3,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    const primary = new Error(`rule marker fetch ${faultAt}`);
    let fetches = 0;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql !== SQLITE_CURSOR_ROW_RULES[0]!.sql) return base;
        return wrapNativeStatement(base, {
          iterate: (...parameters: never[]) => {
            const source = base.iterate(...parameters)[Symbol.iterator]();
            return {
              [Symbol.iterator]() { return this; },
              next: () => {
                fetches += 1;
                if (fetches === faultAt) throw primary;
                return source.next();
              },
              return: () => source.return?.(),
            };
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(fetches).toBe(faultAt);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { changes: 0, caseId: "insert-zero-change" },
    { changes: 2, caseId: "insert-two-changes" },
  ].map((testCase) => [
    `rejects an insert result reporting ${testCase.changes} changed rows [b2:${testCase.caseId}]`,
    testCase,
  ] as const))("%s", (_title, { changes }) => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        return sql === SQLITE_CURSOR_STAGE_INSERT_SQL
          ? wrapNativeStatement(base, {
            run: (...parameters: never[]) => {
              if (changes === 2) {
                base.run(...parameters);
                connection.prepare(
                  "UPDATE temp.ge_blr_cursor_seal SET shape_ok = shape_ok WHERE token_hash = ? AND tenant_id = ?",
                  "inspect-schema",
                ).run(parameters[0], parameters[1]);
              }
              return { changes, lastInsertRowid: 0 };
            },
          })
          : base;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({ message: expect.stringMatching(/stage write count/u) });
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("propagates an inspect/decode fault before any TEMP insert [b2:decode-before-insert-failure]", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(run.receipt);
    const descriptor = witness.sealReceipt.sourceDescriptorHash;
    const schema = witness.sealReceipt.sourceSchemaIdentitySha256;
    const physical = cursorPhysicalValues(descriptor, schema, 1);
    const primary = new Error("authoritative inspect-before-insert failure");
    const hostile = new Proxy(physical, {
      get(target, property, receiver) {
        if (property === "7") throw primary;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const receipt = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
      cursorCount: 1,
      immutableRootSha256: "0".repeat(64),
      sourceDescriptorHash: descriptor,
      sourceSchemaIdentitySha256: schema,
    }));
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalPrepare = native.prepare;
    let insertCalls = 0;
    let sourceInjected = false;
    let observed: unknown;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (sql === SQLITE_CURSOR_STAGE_INSERT_SQL) {
          return wrapNativeStatement(base, {
            run: (...parameters: never[]) => {
              insertCalls += 1;
              return base.run(...parameters);
            },
          });
        }
        if (!sourceInjected && sql === SQLITE_CURSOR_MAIN_SOURCE_QUERY) {
          sourceInjected = true;
          return wrapNativeStatement(base, { iterate: () => [hostile].values() });
        }
        return base;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(run.connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(primary);
      expect(sourceInjected).toBe(true);
      expect(insertCalls).toBe(0);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
      expect(reservedObjects(run.connection)).not.toContain("table:ge_blr_cursor_seal");
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("finalizes a never-run campaign abandonment through stage disposal [b2:abandonment]", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const abandoned = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      expect(abandoned.state).toBe("open");
      expect(reservedObjects(run.connection)).toContain("table:ge_blr_cursor_seal");

      // Deliberately never invoke campaign.run(): the owning stage is the
      // deterministic abandonment/finalization boundary.
      run.stage.dispose();

      expect(abandoned.state).toBe("poisoned");
      expect(run.stage.state).toBe("disposed");
      expect(reservedObjects(run.connection)).not.toContain("table:ge_blr_cursor_seal");
      expect(permanentCursorDigest(run.connection)).toBe(permanentBefore);
    } finally {
      cleanup(run);
    }
  });

  it("cleans an abandoned campaign when its active stage is disposed", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      run.stage.dispose();
      let observed: unknown;
      try {
        campaign.run();
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect(campaign.state).toBe("poisoned");
      expect(reservedObjects(run.connection)).not.toContain("table:ge_blr_cursor_seal");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it("rejects hostile main-catalog evidence before opening the source cursor", () => {
    const run = prepareThrough("legacy");
    const permanentBefore = permanentCursorDigest(run.connection);
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const controller = createSQLiteCursorPreRebindLabelCancellationController(
      "plan:source:before-prepare",
    );
    let catalogReads = 0;
    try {
      native.prepare = function (sql: string): StatementSync {
        const base = Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
        if (!sql.startsWith("SELECT count(*), group_concat(")) return base;
        catalogReads += 1;
        if (catalogReads !== 2) return base;
        return wrapNativeStatement(base, {
          get: (...parameters: never[]) => {
            const value = base.get(...parameters);
            const row = value as unknown as readonly unknown[];
            return [row[0], `${String(row[1])} `];
          },
        });
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      let observed: unknown;
      try {
        runSQLiteCursorPreRebindCampaign(
          run.connection, run.stage, run.receipt, transfer,
          { cancellation: controller.signal },
        );
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({ message: expect.stringMatching(/catalog/u) });
      expect(String((observed as Error).message)).not.toMatch(/cancelled/u);
      expect(catalogReads).toBe(2);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a pre-campaign same-name canonical-index replacement [b2:source-index-ddl-replacement]", () => {
    const connection = openConnection();
    connection.execTrusted(
      "DROP INDEX main.ge_cycle_records_stream_sequence_hash_uq",
      "inspect-schema",
    );
    connection.execTrusted(
      "CREATE UNIQUE INDEX ge_cycle_records_stream_sequence_hash_uq "
        + "ON ge_cycle_records(tenant_id, stream_id, sequence, record_hash DESC)",
      "inspect-schema",
    );
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, run.receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(Error);
      expect(String((observed as Error).message)).toMatch(/canonical identity/u);
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it("rejects a pre-campaign source-table DDL replacement [b2:source-table-ddl-replacement]", () => {
    const connection = openConnection();
    const schemaRow = connection.prepare(
      "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = 'ge_cycle_cursors'",
      "inspect-schema",
    ).get() as unknown as readonly [string];
    const replacement = schemaRow[0].replace(
      /\) STRICT, WITHOUT ROWID$/u,
      ", CHECK (1)) STRICT, WITHOUT ROWID",
    );
    expect(replacement).not.toBe(schemaRow[0]);
    connection.execTrusted("DROP TABLE main.ge_cycle_cursors", "inspect-schema");
    connection.execTrusted(replacement, "inspect-schema");
    const run = prepareThrough("legacy", connection);
    const permanentBefore = permanentCursorDigest(connection);
    let observed: unknown;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, run.receipt, transfer);
      try {
        runSQLiteCursorPreRebindCampaign(connection, run.stage, run.receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(observed).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        message: expect.stringMatching(/canonical identity/u),
      });
      expect(run.stage.state).toBe("poisoned");
      assertCursorFailurePostconditions(run, permanentBefore, observed);
    } finally {
      cleanup(run);
    }
  });

  it("rejects source identity drift at the final reread barrier", () => {
    const run = prepareThrough("legacy");
    const native = DatabaseSync.prototype as unknown as {
      prepare(sql: string): StatementSync;
    };
    const originalPrepare = native.prepare;
    const identitySql = "SELECT provider_descriptor_hash,schema_identity_sha256 "
      + "FROM main.ge_cycle_schema WHERE singleton = 1";
    let identityReads = 0;
    try {
      native.prepare = function (sql: string): StatementSync {
        if (sql === identitySql) {
          identityReads += 1;
          if (identityReads === 3) {
            return {
              get: () => ["0".repeat(64), "0".repeat(64)],
              setAllowBareNamedParameters: () => undefined,
              setAllowUnknownNamedParameters: () => undefined,
              setReadBigInts: () => undefined,
              setReturnArrays: () => undefined,
            } as unknown as StatementSync;
          }
        }
        return Reflect.apply(originalPrepare, this, [sql]) as StatementSync;
      };
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      expect(() => runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow(/final source evidence changed/u);
      expect(identityReads).toBe(3);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      native.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it.each([
    { diagnosticLimit: 1, population: 1, truncated: false },
    { diagnosticLimit: 1, population: 2, truncated: true },
    { diagnosticLimit: 16, population: 16, truncated: false },
    { diagnosticLimit: 16, population: 17, truncated: true },
    { diagnosticLimit: 64, population: 64, truncated: false },
    { diagnosticLimit: 64, population: 65, truncated: true },
  ])("bounds $population hostile rows at diagnostic limit $diagnosticLimit", ({
    diagnosticLimit, population, truncated,
  }) => {
    const connection = openConnection();
    const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    const schema = sqliteText(sqliteRow(connection.prepare(
      "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
      "inspect-schema",
    ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
    connection.prepare("PRAGMA ignore_check_constraints = ON", "inspect-schema").get();
    const insert = connection.prepare(`INSERT INTO ge_cycle_cursors
      (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
       checkpoint_scope,request_scope_blob,page_size,next_position,
       snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
       schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`, "inspect-schema");
    for (let index = 0; index < population; index += 1) {
      insert.run(
        `tenant-${index}`, index.toString(16).padStart(64, "0"), "event", "bad",
        "3".repeat(64), `stream-${index}`, null,
        Buffer.from(`{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"stream-${index}"}`),
        1, 0, -1, null, descriptor, schema,
        Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
        CAPTURED_AT_MS, CAPTURED_AT_MS + 1,
      );
    }
    connection.prepare("PRAGMA ignore_check_constraints = OFF", "inspect-schema").get();
    const run = prepareThrough("legacy", connection);
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, run.receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        connection, run.stage, run.receipt, transfer, { diagnosticLimit },
      );
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([
        diagnosticLimit, 0, 0, 0, 0, 0, 1, 0, 0, 0,
      ]);
      expect(outcome.diagnostics[0]).toEqual({
        ruleId: "BLR_CURSOR_AUTHORIZATION",
        violationCount: diagnosticLimit,
        diagnosticsTruncated: truncated,
      });
    } finally {
      cleanup(run);
    }
  });

  it("diagnoses retained-A2b versus live source inventory only through rule 7 [b2:source-stage-count-delta]", () => {
    const connection = openConnection();
    const hash = "1".repeat(64);
    const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
    const schema = sqliteText(sqliteRow(connection.prepare(
      "SELECT schema_identity_sha256 FROM ge_cycle_schema WHERE singleton=1",
      "inspect-schema",
    ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
    connection.prepare(`INSERT INTO ge_cycle_cursors
      (tenant_id,token_hash,kind,principal_hash,authorization_hash,stream_id,
       checkpoint_scope,request_scope_blob,page_size,next_position,
       snapshot_tail_sequence,snapshot_tail_record_hash,descriptor_hash,
       schema_identity_sha256,snapshot_blob,created_at_ms,expires_at_ms,consumed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`, "inspect-schema").run(
      "tenant-a", hash, "event", "2".repeat(64), "3".repeat(64), "stream-a", null,
      Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,"streamId":"stream-a"}'),
      1, 0, -1, null, descriptor, schema,
      Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}'),
      CAPTURED_AT_MS, CAPTURED_AT_MS + 1,
    );
    const run = prepareThrough("legacy", connection);
    try {
      // The test issuer intentionally retains the accepted empty A1 authority.
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const outcome = runSQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      expect(outcome.status).toBe("diagnosed");
      expect(outcome.vector).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
      expect(outcome.diagnostics).toEqual([{
        ruleId: "BLR_CURSOR_SEAL_COUNT",
        violationCount: 1,
        diagnosticsTruncated: false,
      }]);
    } finally {
      cleanup(run);
    }
  });

  it("rejects an equal-count substituted row through the terminal A1 root fence "
    + "[b2:equal-count-insert-delete]", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined);
    const run = prepareThrough("legacy", connection);
    try {
      const stale = mintReceipt(run.sourceSummary, run.projectionIdentity, Object.freeze({
        cursorCount: 1,
        immutableRootSha256: "0".repeat(64),
        sourceDescriptorHash: descriptor,
        sourceSchemaIdentitySha256: schema,
      }));
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, stale,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, stale, transfer);
      expect(() => runSQLiteCursorPreRebindCampaign(
        connection, run.stage, stale, transfer,
      )).toThrow(/A1 authority changed/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  it("fails closed on an equal-count main insert-delete substitution", () => {
    const connection = openConnection();
    const [descriptor, schema] = insertCursorPhysicalRow(connection, () => undefined, 1);
    const run = prepareThrough("legacy", connection);
    const originalRows = connection.prepare(
      SQLITE_CURSOR_MAIN_SOURCE_QUERY, "inspect-schema",
    ).all();
    const receipt = mintReceipt(
      run.sourceSummary,
      run.projectionIdentity,
      sealSQLiteCursorRows(1, descriptor, schema, originalRows.map(decodeSQLiteCursorSealRow)),
    );
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        connection, run.stage, receipt,
      );
      createSQLiteCursorSealTempTable(connection, run.stage, receipt, transfer);
      const changesBeforeSubstitution = totalChanges(connection);
      const permanentBeforeSubstitution = permanentCursorDigest(connection);
      connection.prepare(
        "DELETE FROM main.ge_cycle_cursors WHERE tenant_id = ?", "inspect-schema",
      ).run("tenant-1");
      insertCursorPhysicalRow(connection, () => undefined, 2);
      expect(totalChanges(connection)).toBe(changesBeforeSubstitution + 2);
      expect(connection.prepare(
        "SELECT count(*) FROM main.ge_cycle_cursors", "inspect-schema",
      ).get()).toEqual([1n]);
      const permanentAfterSubstitution = permanentCursorDigest(connection);
      expect(permanentAfterSubstitution).not.toBe(permanentBeforeSubstitution);
      let observed: unknown;
      let outcome: unknown;
      try {
        outcome = runSQLiteCursorPreRebindCampaign(connection, run.stage, receipt, transfer);
      } catch (error) {
        observed = error;
      }
      expect(outcome).toBeUndefined();
      expect(observed).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
      expect(String((observed as Error).message)).toMatch(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
      run.stage.dispose();
      expect(permanentCursorDigest(connection)).toBe(permanentAfterSubstitution);
      expect(reservedObjects(connection)).not.toContain("table:ge_blr_cursor_seal");
    } finally {
      cleanup(run);
    }
  });
});

describe("SQLite Cursor Slice B1 owned cursor catalog", () => {
  it("is byte-for-byte bound to the shared cross-language conformance fixture", () => {
    const fixture = JSON.parse(readFileSync(new URL(
      "../../../spec/conformance/sqlite-cursor-stage-ownership.case.json",
      import.meta.url,
    ), "utf8")) as {
      contract: string;
      cursorSealTempTableDdl: string;
      cursorSealTempTableDdlSha256: string;
      sqliteSchemaSql: string;
      rootpageRule: unknown;
      tableList: unknown;
      xinfo: unknown;
      outcomes: readonly string[];
      requiredScenarios: readonly { name: string; expect: string }[];
    };
    expect(Object.keys(fixture)).toEqual([
      "contract",
      "cursorSealTempTableDdl",
      "cursorSealTempTableDdlSha256",
      "sqliteSchemaSql",
      "rootpageRule",
      "tableList",
      "xinfo",
      "outcomes",
      "requiredScenarios",
    ]);
    expect(fixture.contract).toBe(
      "graphengineering.reacher-z.github.io/sqlite-cursor-stage-ownership/v1alpha1",
    );
    expect(SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL).toBe(fixture.cursorSealTempTableDdl);
    expect(createHash("sha256").update(SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL).digest("hex"))
      .toBe(fixture.cursorSealTempTableDdlSha256);
    expect(SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL_SHA256)
      .toBe(fixture.cursorSealTempTableDdlSha256);
    expect(SQLITE_CURSOR_SEAL_SCHEMA_SQL).toBe(fixture.sqliteSchemaSql);
    expect(fixture.rootpageRule).toEqual({
      type: "safe-positive-integer",
      stableWithinStageSession: true,
    });
    expect(SQLITE_CURSOR_SEAL_TABLE_LIST).toEqual(fixture.tableList);
    expect(SQLITE_CURSOR_SEAL_XINFO).toEqual(fixture.xinfo);
    expect(fixture.outcomes).toEqual([
      "accepted",
      "invalid-authority",
      "stale-epoch",
      "unexplained-write",
      "incomplete-stage",
      "already-started",
      "poisoned",
      "disposed",
    ]);
    expect(fixture.requiredScenarios).toEqual([
      { name: "b0-complete-real-predecessors", expect: "accepted" },
      { name: "b0-invalid-receipt-a2b-first", expect: "invalid-authority" },
      { name: "b0-wrong-exact-owner", expect: "invalid-authority" },
      { name: "b0-stale-capture-epoch", expect: "stale-epoch" },
      { name: "b0-unexplained-stage-write", expect: "unexplained-write" },
      { name: "b0-incomplete-predecessor", expect: "incomplete-stage" },
      { name: "b0-second-begin", expect: "already-started" },
      { name: "b1-owned-exact-create", expect: "accepted" },
      { name: "b1-epoch-plus-zero", expect: "stale-epoch" },
      { name: "b1-epoch-plus-two", expect: "stale-epoch" },
      { name: "b1-transaction-replacement", expect: "stale-epoch" },
      { name: "b1-caller-ddl", expect: "stale-epoch" },
      { name: "b1-row-change-drift", expect: "unexplained-write" },
      { name: "b1-catalog-shape-drift", expect: "poisoned" },
      {
        name: "b1-historical-witness-stale-retained-transfer-live",
        expect: "accepted",
      },
      { name: "b1-capture-epoch-immutable", expect: "accepted" },
      { name: "b1-disposed-stage", expect: "disposed" },
    ]);
    expect(new Set(fixture.requiredScenarios.map(({ name }) => name))).toEqual(new Set([
      "b0-complete-real-predecessors",
      "b0-invalid-receipt-a2b-first",
      "b0-wrong-exact-owner",
      "b0-stale-capture-epoch",
      "b0-unexplained-stage-write",
      "b0-incomplete-predecessor",
      "b0-second-begin",
      "b1-owned-exact-create",
      "b1-epoch-plus-zero",
      "b1-epoch-plus-two",
      "b1-transaction-replacement",
      "b1-caller-ddl",
      "b1-row-change-drift",
      "b1-catalog-shape-drift",
      "b1-historical-witness-stale-retained-transfer-live",
      "b1-capture-epoch-immutable",
      "b1-disposed-stage",
    ]));
    expect(new Set(fixture.requiredScenarios.map(({ expect }) => expect))).toEqual(new Set([
      "accepted", "invalid-authority", "stale-epoch", "unexplained-write",
      "incomplete-stage", "already-started", "poisoned", "disposed",
    ]));
  });

  it("creates the exact STRICT/WITHOUT ROWID catalog at epoch +1 and row delta +0", () => {
    const run = prepareThrough("legacy");
    try {
      const witness = assertSQLiteCursorPreRebindConnectionProvenance(
        run.connection, run.receipt,
      );
      const beforeEpoch = readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch;
      const beforeChanges = totalChanges(run.connection);
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(
        run.connection, run.stage, run.receipt, transfer,
      );

      expect(readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch)
        .toBe(beforeEpoch + 1n);
      expect(totalChanges(run.connection)).toBe(beforeChanges);
      expect(assertSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt, transfer,
      )).toBe(transfer);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        run.connection, run.receipt, witness,
      )).toThrow(/captured transaction|provenance witness/u);

      const schema = run.connection.prepare(
        "SELECT rootpage, sql FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        "inspect-schema",
      ).get() as unknown as readonly [bigint, string];
      expect(schema[0]).toBeGreaterThan(0n);
      expect(schema[1]).toBe(SQLITE_CURSOR_SEAL_SCHEMA_SQL);
      const tableList = run.connection.prepare(
        "SELECT name, type, ncol, wr, strict FROM pragma_table_list "
          + "WHERE schema = 'temp' AND name = 'ge_blr_cursor_seal'",
        "inspect-schema",
      ).get();
      expect(tableList).toEqual([
        "ge_blr_cursor_seal", "table", 30n, 1n, 1n,
      ]);
    } finally {
      cleanup(run);
    }
  });

  it("uses captured begin/fence/create intrinsics under hostile prototype replacement", () => {
    const run = prepareThrough("legacy");
    const prototype = Object.getPrototypeOf(run.stage) as Record<PropertyKey, unknown>;
    const symbols = [
      SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER,
      SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER,
      SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE,
      SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER,
    ] as const;
    const originals = symbols.map((symbol) => Object.getOwnPropertyDescriptor(prototype, symbol));
    let hostileCalls = 0;
    try {
      for (const symbol of symbols) {
        Object.defineProperty(prototype, symbol, {
          configurable: true,
          value: () => { hostileCalls += 1; },
          writable: true,
        });
      }
      const beforeEpoch = readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch;
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(
        run.connection, run.stage, run.receipt, transfer,
      );
      expect(assertSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt, transfer,
      )).toBe(transfer);
      expect(hostileCalls).toBe(0);
      expect(readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch)
        .toBe(beforeEpoch + 1n);
    } finally {
      symbols.forEach((symbol, index) => {
        const descriptor = originals[index];
        if (descriptor !== undefined) Object.defineProperty(prototype, symbol, descriptor);
      });
      cleanup(run);
    }
  });

  it("rejects a staged constant-lie public epoch getter on the first retained B1 fence", () => {
    class ConstantLieConnection extends SQLiteConnection {
      #armed = false;
      #reads = 0;

      arm(): void {
        this.#armed = true;
        this.#reads = 0;
      }

      override get transactionEpoch(): bigint {
        const real = super.transactionEpoch;
        if (!this.#armed) return real;
        this.#reads += 1;
        // The first public read satisfies the legacy pre-catalog owner check.
        // Every later read repeats one stable lie; the old catalog helper
        // incorrectly adopted that lie and let the retained fence succeed.
        return this.#reads <= 1 ? real : 999n;
      }
    }

    const run = prepareThrough("legacy", openConnection(ConstantLieConnection));
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      run.connection.arm();
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow();
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });

  it("ignores replaceable public exec and WeakMap publication hooks", () => {
    const run = prepareThrough("legacy");
    const originalExec = run.connection.execTrusted;
    const originalSet = WeakMap.prototype.set;
    let hostileCalls = 0;
    try {
      run.connection.execTrusted = (() => { hostileCalls += 1; }) as SQLiteConnection["execTrusted"];
      WeakMap.prototype.set = function () {
        throw new Error("hostile replaceable WeakMap.set");
      } as typeof WeakMap.prototype.set;
      const beforeEpoch = readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch;
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      WeakMap.prototype.set = originalSet;
      expect(hostileCalls).toBe(0);
      expect(readSQLiteConnectionOwnerSnapshot(run.connection).transactionEpoch)
        .toBe(beforeEpoch + 1n);
    } finally {
      run.connection.execTrusted = originalExec;
      WeakMap.prototype.set = originalSet;
      cleanup(run);
    }
  });

  it("uses captured SQL intrinsics for every active B2 owner fence", () => {
    const run = prepareThrough("legacy");
    const originalPrepare = run.connection.prepare;
    let hostileCalls = 0;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      const campaign = new SQLiteCursorPreRebindCampaign(
        run.connection, run.stage, run.receipt, transfer,
      );
      run.connection.prepare = (() => {
        hostileCalls += 1;
        throw new Error("replaceable public prepare reached during B2");
      }) as SQLiteConnection["prepare"];
      Object.defineProperty(run.connection, "transactionEpoch", {
        configurable: true,
        get() {
          hostileCalls += 1;
          throw new Error("replaceable public transactionEpoch reached during B2");
        },
      });
      const outcome = campaign.run();
      expect(outcome.status).toBe("pre-rebind-complete");
      expect(hostileCalls).toBe(0);
      expect(campaign.state).toBe("complete");
    } finally {
      Reflect.deleteProperty(run.connection, "transactionEpoch");
      run.connection.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("poisons on an injected epoch +2 adoption race and cleans the cursor object", () => {
    const run = prepareThrough("legacy");
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      run.connection, run.stage, run.receipt,
    );
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let injected = false;
    try {
      run.connection.prepare = ((sql: string, operation: "inspect-schema") => {
        if (!injected && sql.includes("FROM temp.sqlite_schema")) {
          injected = true;
          originalPrepare("PRAGMA schema_version", "inspect-schema").get();
        }
        return originalPrepare(sql, operation);
      }) as SQLiteConnection["prepare"];
      expect(() => createSQLiteCursorSealTempTable(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow();
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      expect(reservedObjects(run.connection)).not.toContain("table:ge_blr_cursor_seal");
      cleanup(run);
    }
  });

  it("preserves the primary B1 failure when cleanup owner snapshot also fails", () => {
    const run = prepareThrough("legacy");
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      run.connection, run.stage, run.receipt,
    );
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const primary = new Error("authoritative hostile cursor catalog failure");
    let injected = false;
    let observed: unknown;
    try {
      run.connection.prepare = ((sql: string, operation: "inspect-schema") => {
        if (!injected && sql.includes("WHERE name = 'ge_blr_cursor_seal'")) {
          injected = true;
          run.connection.close();
          throw primary;
        }
        return originalPrepare(sql, operation);
      }) as SQLiteConnection["prepare"];
      try {
        createSQLiteCursorSealTempTable(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      expect(injected).toBe(true);
      expect(observed).toBe(primary);
      expect(run.stage.state).toBe("poisoned");
      expect(run.connection.isOpen).toBe(false);
    } finally {
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      cleanup(run);
    }
  });

  it("poisons on transaction replacement during B1 validation", () => {
    const run = prepareThrough("legacy");
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      run.connection, run.stage, run.receipt,
    );
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let injected = false;
    try {
      run.connection.prepare = ((sql: string, operation: "inspect-schema") => {
        if (!injected && sql.includes("FROM temp.sqlite_schema")) {
          injected = true;
          run.connection.execTrusted("ROLLBACK", "inspect-schema");
          run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        }
        return originalPrepare(sql, operation);
      }) as SQLiteConnection["prepare"];
      expect(() => createSQLiteCursorSealTempTable(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow();
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      cleanup(run);
    }
  });

  it("never deletes a same-name replacement from a new transaction generation", () => {
    const run = prepareThrough("legacy");
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      run.connection, run.stage, run.receipt,
    );
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const primary = new Error("authoritative post-create replacement race");
    let injected = false;
    let observed: unknown;
    try {
      run.connection.prepare = ((sql: string, operation: "inspect-schema") => {
        if (!injected && sql.includes("WHERE name = 'ge_blr_cursor_seal'")) {
          injected = true;
          run.connection.execTrusted("ROLLBACK", "inspect-schema");
          run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
          run.connection.execTrusted(
            "CREATE TEMP TABLE ge_blr_cursor_seal (replacement_marker TEXT) STRICT",
            "inspect-schema",
          );
          throw primary;
        }
        return originalPrepare(sql, operation);
      }) as SQLiteConnection["prepare"];
      try {
        createSQLiteCursorSealTempTable(
          run.connection, run.stage, run.receipt, transfer,
        );
      } catch (error) {
        observed = error;
      }
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      expect(injected).toBe(true);
      expect(observed).toBe(primary);
      expect(run.stage.state).toBe("poisoned");
      expect(run.connection.prepare(
        "SELECT sql FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        "inspect-schema",
      ).get()).toEqual([
        "CREATE TABLE ge_blr_cursor_seal (replacement_marker TEXT) STRICT",
      ]);

      run.stage.dispose();
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        "inspect-schema",
      ).get()).toEqual([1n]);
    } finally {
      run.connection.prepare = originalPrepare as SQLiteConnection["prepare"];
      cleanup(run);
    }
  });

  it("rejects caller DDL before B1 and main DML/PRAGMA after transfer", () => {
    for (const mutate of [
      (connection: SQLiteConnection) => connection.execTrusted(
        "CREATE TEMP TABLE ge_blr_cursor_seal (x INTEGER) STRICT",
        "inspect-schema",
      ),
      (connection: SQLiteConnection) => connection.prepare(
        "UPDATE main.ge_cycle_schema SET updated_at_ms = updated_at_ms",
        "inspect-schema",
      ).run(),
      (connection: SQLiteConnection) => connection.prepare(
        "PRAGMA schema_version",
        "inspect-schema",
      ).get(),
    ]) {
      const run = prepareThrough("legacy");
      try {
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt,
        );
        mutate(run.connection);
        expect(() => createSQLiteCursorSealTempTable(
          run.connection, run.stage, run.receipt, transfer,
        )).toThrow();
        expect(run.stage.state).toBe("poisoned");
      } finally {
        cleanup(run);
      }
    }
  });

  it("retained transfer detects row and catalog tamper after successful B1", () => {
    for (const mutate of [
      (connection: SQLiteConnection) => connection.prepare(
        `INSERT INTO temp.ge_blr_cursor_seal (
          token_hash, tenant_id, kind, principal_hash, authorization_hash,
          request_scope_byte_length, request_scope_blob_sha256, page_size,
          next_position, snapshot_byte_length, snapshot_blob_sha256,
          created_at_ms, expires_at_ms, descriptor_hash, schema_identity_sha256,
          authorization_ok, scope_ok, blobs_canonical_ok, position_ok, clock_ok,
          catalog_ok, shape_ok, event_binding_ok, checkpoint_binding_ok, seal_eligible
        ) VALUES ('t', 'tenant', 'k', 'p', 'a', 0, 'r', 1, 0, 0, 's', 0, 1,
                  'd', 'i', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`,
        "inspect-schema",
      ).run(),
      (connection: SQLiteConnection) => connection.execTrusted(
        "DROP TABLE temp.ge_blr_cursor_seal",
        "inspect-schema",
      ),
    ]) {
      const run = prepareThrough("legacy");
      try {
        const transfer = beginSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt,
        );
        createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
        mutate(run.connection);
        expect(() => assertSQLiteCursorStageOwnershipTransfer(
          run.connection, run.stage, run.receipt, transfer,
        )).toThrow();
        expect(run.stage.state).toBe("poisoned");
      } finally {
        cleanup(run);
      }
    }
  });

  it("never deletes an unproven B1 replacement generation on poisoned disposal", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      run.connection.execTrusted(
        "DROP TABLE temp.ge_blr_cursor_seal",
        "inspect-schema",
      );
      run.connection.execTrusted(
        "CREATE TEMP TABLE ge_blr_cursor_seal (caller_owned INTEGER) STRICT",
        "inspect-schema",
      );
      expect(() => assertSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow();
      expect(run.stage.state).toBe("poisoned");
      run.stage.dispose();
      expect(run.stage.state).toBe("disposed");
      const row = run.connection.prepare(
        "SELECT sql FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        "inspect-schema",
      ).get() as unknown as readonly unknown[];
      expect(String(row[0])).toContain("caller_owned");
    } finally {
      cleanup(run);
    }
  });

  it("uses captured SQL to dispose an owned B1 seal in a crowded hostile catalog", () => {
    const run = prepareThrough("legacy");
    const native = DatabaseSync.prototype as unknown as { prepare(sql: string): StatementSync };
    const originalNativePrepare = native.prepare;
    const originalExec = run.connection.execTrusted;
    const originalPrepare = run.connection.prepare;
    let hostileExecCalls = 0;
    let hostilePrepareCalls = 0;
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      let crowded = false;
      native.prepare = function (sql: string): StatementSync {
        if (!crowded && sql === "SELECT 1") {
          crowded = true;
          for (let index = 0; index < 40; index += 1) {
            Reflect.apply(originalNativePrepare, this, [
              `CREATE TEMP TABLE ge_blr_hostile_${String(index).padStart(3, "0")}`
                + " (value INTEGER)",
            ]).run();
          }
          Reflect.apply(originalNativePrepare, this, [
            "PRAGMA reverse_unordered_selects = ON",
          ]).run();
        }
        return Reflect.apply(originalNativePrepare, this, [sql]) as StatementSync;
      };
      run.connection.prepare("SELECT 1", "inspect-schema").get();
      native.prepare = originalNativePrepare;
      expect(crowded).toBe(true);

      run.connection.execTrusted = (() => {
        hostileExecCalls += 1;
      }) as SQLiteConnection["execTrusted"];
      run.connection.prepare = (() => {
        hostilePrepareCalls += 1;
        return { get: () => [0n] } as unknown as StatementSync;
      }) as SQLiteConnection["prepare"];

      expect(() => run.stage.dispose()).toThrowError(/disposal left reserved objects/u);
      expect(run.stage.state).toBe("poisoned");
      expect(hostileExecCalls).toBe(0);
      expect(hostilePrepareCalls).toBe(0);

      run.connection.execTrusted = originalExec;
      run.connection.prepare = originalPrepare;
      const remaining = reservedObjects(run.connection);
      expect(remaining).toHaveLength(40);
      expect(remaining.every((identity) => identity.startsWith("table:ge_blr_hostile_")))
        .toBe(true);
      expect(remaining).not.toContain("table:ge_blr_cursor_seal");
    } finally {
      native.prepare = originalNativePrepare;
      run.connection.execTrusted = originalExec;
      run.connection.prepare = originalPrepare;
      cleanup(run);
    }
  });

  it("rejects a second B1 create and a disposed stage", () => {
    const run = prepareThrough("legacy");
    try {
      const transfer = beginSQLiteCursorStageOwnershipTransfer(
        run.connection, run.stage, run.receipt,
      );
      createSQLiteCursorSealTempTable(run.connection, run.stage, run.receipt, transfer);
      expect(() => createSQLiteCursorSealTempTable(
        run.connection, run.stage, run.receipt, transfer,
      )).toThrow(/already started/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      cleanup(run);
    }
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
