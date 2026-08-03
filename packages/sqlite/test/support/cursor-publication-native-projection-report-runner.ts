import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalHash } from "@graph-engineering/core";
import { cycleStoreAdapterCodec } from "@graph-engineering/runtime";

import {
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic,
  assertSQLiteCursorPublicationNativeMutationParentIntrinsic,
  boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic,
  captureSQLiteCursorPublicationNativeProjectionIntrinsic,
} from "../../src/cursor-publication-owner-composition.js";
import {
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
} from "../../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../../src/migrations.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../../src/operation-baseline-source.js";
import { SQLiteConnection } from "../../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../../src/sqlite-profile.js";
import {
  createSQLiteCursorNativeProjectionNormalizedReport,
  normalizeSQLiteCursorNativeProjectionRejectionCase,
  normalizeSQLiteCursorNativeProjectionSuccessCase,
  type SQLiteCursorNativeProjectionNormalizedReport,
} from "./cursor-publication-native-projection-normalized-report.js";

const APPLIED_AT_MS = 1_785_110_405_000;

function seedLegacyOperations(connection: SQLiteConnection, count: number): void {
  const result = { deleted: false } as const;
  const blob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("delete-checkpoint", result),
  );
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    connection.prepare(`
      INSERT INTO ge_cycle_operations
        (tenant_id, operation_id, operation_name, request_hash,
         result_blob, result_hash, committed_at_ms)
      VALUES (?, ?, 'delete-checkpoint', ?, ?, ?, ?)
    `, "inspect-schema").run(
      "tenant-a",
      `operation-${ordinal}`,
      createHash("sha256").update(`request-${ordinal}`).digest("hex"),
      blob,
      canonicalHash(result),
      APPLIED_AT_MS,
    );
  }
}

function withGraph<T>(
  root: string,
  optionalCount: number,
  use: (value: Readonly<{
    readonly connection: SQLiteConnection;
    readonly owner: ReturnType<typeof registerSQLiteCursorPublicationTransactionOwnerIntrinsic>;
    readonly composition: ReturnType<
      typeof adoptSQLiteCursorPublicationOwnerCompositionIntrinsic
    >;
    readonly summary: SQLiteV1BaselineSourceSummary;
  }>) => T,
): T {
  mkdirSync(root, { recursive: true });
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: APPLIED_AT_MS,
  });
  seedLegacyOperations(connection, optionalCount);
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const beginReceipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
    owner,
    beginReceipt,
  );
  try {
    return use({ composition, connection, owner, summary });
  } finally {
    if (readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner).lifecycle
        === "active") {
      const primary = new Error("NP1_REPORT_BOUNDED_STOP");
      try {
        boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
          composition,
          primary,
        );
      } catch (error) {
        if (error !== primary) throw error;
      }
    }
  }
}

/** Build the real file-backed TypeScript NP1 report without exposing authority. */
export function buildTypeScriptSQLiteCursorNativeProjectionReport():
SQLiteCursorNativeProjectionNormalizedReport {
  const reportRoot = mkdtempSync(join(tmpdir(), "graph-engineering-np1-report-"));
  try {
    const successCases = ([0, 1, 3] as const).map((optionalCount) => {
      const root = join(reportRoot, `success-${optionalCount}`);
      return withGraph(root, optionalCount, ({ composition, summary }) =>
        normalizeSQLiteCursorNativeProjectionSuccessCase(
          optionalCount,
          assertSQLiteCursorPublicationNativeMutationParentIntrinsic(
            captureSQLiteCursorPublicationNativeProjectionIntrinsic(composition, summary),
          ),
        ));
    });
    const rejectionCases = ([0, 1] as const).map((impossibleCount) => {
      const root = join(reportRoot, `rejection-${impossibleCount}`);
      return withGraph(root, 0, ({ composition, owner, summary }) => {
        const forged = Object.freeze({
          ...summary,
          expectedEntryCount: impossibleCount,
        }) as SQLiteV1BaselineSourceSummary;
        let rejection: unknown;
        try {
          captureSQLiteCursorPublicationNativeProjectionIntrinsic(composition, forged);
        } catch (error) {
          rejection = error;
        }
        return normalizeSQLiteCursorNativeProjectionRejectionCase(
          impossibleCount,
          rejection,
          readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner),
        );
      });
    });
    return createSQLiteCursorNativeProjectionNormalizedReport(successCases, rejectionCases);
  } finally {
    rmSync(reportRoot, { recursive: true, force: true });
  }
}
