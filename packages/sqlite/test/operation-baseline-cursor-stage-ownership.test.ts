import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
import { SQLITE_CURSOR_SEAL_EMPTY_ROOT } from "../src/operation-baseline-cursor-invariants.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

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
): SQLiteCursorPreRebindReceipt {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt = Object.freeze({
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

  it("rejects forged transfer clones and receipts from another exact issuer", () => {
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

  it("requires the exact stage-owned projection identity", () => {
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
