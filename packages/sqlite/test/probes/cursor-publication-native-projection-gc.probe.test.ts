import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic,
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic,
  boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic,
  captureSQLiteCursorPublicationNativeProjectionIntrinsic,
  consumeSQLiteCursorPublicationMutationChildPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationParentScopeIntrinsic,
  enterSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationMutationChildPermitIntrinsic,
  observeSQLiteCursorPublicationNativeReceiptRetentionForTestIntrinsic,
  prepareSQLiteCursorPublicationReusableParentIntrinsic,
  recordSQLiteCursorPublicationMutationChildReturnIntrinsic,
  retireSQLiteCursorPublicationMutationChildResourceIntrinsic,
  retireSQLiteCursorPublicationReusableParentResourceIntrinsic,
} from "../../src/cursor-publication-owner-composition.js";
import {
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
} from "../../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../../src/migrations.js";
import { captureSQLiteV1BaselineSourceSummary } from
  "../../src/operation-baseline-source.js";
import { SQLiteConnection } from "../../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../../src/sqlite-profile.js";

const run = process.env.GRAPH_ENGINEERING_RUN_NP1_EXPOSE_GC_PROBE === "1" ? it : it.skip;

describe("SQLite NP1 receipt retention", () => {
  run("strongly retains until parent consume and then releases the receipt", async () => {
    expect(globalThis.gc).toBeTypeOf("function");
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-np1-gc-"));
    const connection = new SQLiteConnection(join(root, "cycle-store.db"));
    ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
      appliedAtMs: 1_785_110_405_000,
    });
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    const begin = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    const summary = captureSQLiteV1BaselineSourceSummary(connection, 1_785_110_405_000);
    const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(owner, begin);
    try {
      const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        composition,
        summary,
      );
      const retention = observeSQLiteCursorPublicationNativeReceiptRetentionForTestIntrinsic(
        parent,
      );
      expect(retention?.isRetained()).toBe(true);
      globalThis.gc?.();
      expect(retention?.isRetained()).toBe(true);

      prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
      for (let ordinal = 0; ordinal < 3; ordinal += 1) {
        const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, ordinal);
        enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
        recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
        retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
        acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
        consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      }
      retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
      consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
      expect(observeSQLiteCursorPublicationNativeReceiptRetentionForTestIntrinsic(parent))
        .toBeUndefined();

      for (let attempt = 0; attempt < 40; attempt += 1) {
        // Do not deref inside the loop: ECMAScript keeps a dereferenced target
        // alive until the end of the current job, which would defeat this probe.
        Array.from({ length: 1_024 }, (_value, ordinal) => ({ attempt, ordinal }));
        globalThis.gc?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(retention?.isRetained()).toBe(false);
      const primary = new Error("NP1_GC_BOUNDED_STOP");
      expect(() => boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
        composition,
        primary,
      )).toThrow(primary);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
