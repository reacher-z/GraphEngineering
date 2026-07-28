import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { createSQLitePhysicalBackup } from "../src/backup.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { sqliteRow, sqliteSafeInteger } from "../src/sqlite-codec.js";

const temporaryRoots: string[] = [];

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-backup-"));
  temporaryRoots.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("SQLite physical backup", () => {
  it("captures committed WAL content and publishes a verified new file", async () => {
    const directory = root();
    const sourcePath = join(directory, "source.db");
    const destination = join(directory, "backup.db");
    const source = new SQLiteConnection(sourcePath);
    try {
      source.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      source.immediate("append", () => {
        source.prepare("INSERT INTO t (value) VALUES (?)", "append").run(7);
      });
      const report = await createSQLitePhysicalBackup(source, destination, { ratePages: 1 });
      expect(report.path).toBe(destination);
      expect(report.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(report.bytes).toBe(readFileSync(destination).byteLength);
      expect(report.pages).toBeGreaterThan(0);
      expect(report.integrity.quickCheck).toBe("ok");
      expect(existsSync(destination)).toBe(true);

      const restored = new SQLiteConnection(destination);
      try {
        const row = sqliteRow(
          restored.prepare("SELECT value FROM t", "read-tail").get(),
          1,
          "read-tail",
          "value",
        );
        expect(sqliteSafeInteger(row[0], 0, 10, "read-tail", "value")).toBe(7);
      } finally {
        restored.close();
      }
    } finally {
      source.close();
    }
  });

  it("refuses source overwrite and existing destinations", async () => {
    const directory = root();
    const sourcePath = join(directory, "source.db");
    const source = new SQLiteConnection(sourcePath);
    try {
      await expect(createSQLitePhysicalBackup(source, sourcePath)).rejects.toMatchObject({
        code: "GE_CYCLE_STORE_INVALID_ARGUMENT",
      });
      const destination = join(directory, "existing.db");
      const existing = new SQLiteConnection(destination);
      existing.close();
      await expect(createSQLitePhysicalBackup(source, destination)).rejects.toMatchObject({
        code: "GE_CYCLE_STORE_CONFLICT",
      });
    } finally {
      source.close();
    }
  });

  it("honors cancellation before creating a destination", async () => {
    const directory = root();
    const destination = join(directory, "cancelled.db");
    const source = new SQLiteConnection(join(directory, "source.db"));
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(createSQLitePhysicalBackup(source, destination, {
        signal: controller.signal,
      })).rejects.toBeInstanceOf(CycleStoreProviderError);
      expect(existsSync(destination)).toBe(false);
    } finally {
      source.close();
    }
  });

  it("rejects unsafe administration bounds before native backup", async () => {
    const directory = root();
    const source = new SQLiteConnection(join(directory, "source.db"));
    try {
      await expect(createSQLitePhysicalBackup(source, join(directory, "bad.db"), {
        ratePages: 0,
      })).rejects.toMatchObject({ code: "GE_CYCLE_STORE_INVALID_ARGUMENT" });
    } finally {
      source.close();
    }
  });
});
