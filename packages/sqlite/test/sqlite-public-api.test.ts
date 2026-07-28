import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as sqlite from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("@graph-engineering/sqlite public surface", () => {
  it("exports only the durable provider, fixed identities, audit, backup, and restore", async () => {
    expect(Object.keys(sqlite).sort()).toEqual([
      "SQLITE_ALPHA_V0_TO_V1_SQL_SHA256",
      "SQLITE_BACKUP_MANIFEST_API_VERSION",
      "SQLITE_BACKUP_MANIFEST_DOMAIN",
      "SQLITE_CYCLE_STORE_APPLICATION_ID",
      "SQLITE_CYCLE_STORE_DESCRIPTOR_HASH",
      "SQLITE_CYCLE_STORE_MINIMUM_NODE_VERSION",
      "SQLITE_CYCLE_STORE_PROVIDER_ID",
      "SQLITE_CYCLE_STORE_SCHEMA_VERSION",
      "SQLITE_MIGRATION_MANIFEST_SHA256",
      "SQLITE_SCHEMA_CATALOG_SHA256",
      "SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256",
      "SQLITE_SCHEMA_IDENTITY_SHA256",
      "SQLITE_SCHEMA_SQL_SHA256",
      "SQLiteCycleStoreProvider",
      "checkpointSQLiteCycleStoreWal",
      "createSQLiteCycleStoreBackup",
      "createSQLiteCycleStoreDescriptor",
      "inspectSQLiteCycleStoreIntegrity",
      "restoreSQLiteCycleStoreBackup",
    ]);
    expect("SQLiteConnection" in sqlite).toBe(false);

    const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-public-"));
    temporaryRoots.push(root);
    const provider = new sqlite.SQLiteCycleStoreProvider(join(root, "store.db"), {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    try {
      expect((await provider.describe()).descriptorHash).toBe(
        sqlite.SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
      );
    } finally {
      provider.close();
    }
  });
});
