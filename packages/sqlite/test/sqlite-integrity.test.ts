import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { inspectSQLitePhysicalIntegrity } from "../src/integrity.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";

const temporaryRoots: string[] = [];

function temporaryPath(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-integrity-"));
  temporaryRoots.push(root);
  return join(root, name);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite physical integrity", () => {
  it("accepts a closed, physically consistent WAL database", () => {
    const path = temporaryPath("healthy.db");
    const connection = new SQLiteConnection(path);
    connection.execTrusted(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES parent(id)
      ) STRICT;
      INSERT INTO parent (id) VALUES (1);
      INSERT INTO child (id, parent_id) VALUES (1, 1);
    `, "inspect-schema");
    connection.close();

    expect(inspectSQLitePhysicalIntegrity(path)).toMatchObject({
      quickCheck: "ok",
      integrityCheck: "ok",
      foreignKeyViolations: 0,
    });
  });

  it("rejects a file that is not a SQLite database without leaking bytes", () => {
    const path = temporaryPath("not-a-database.db");
    writeFileSync(path, "PAYLOAD_SENTINEL /secret/location");
    try {
      inspectSQLitePhysicalIntegrity(path);
      throw new Error("expected integrity failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleStoreProviderError);
      expect(error).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(
        "PAYLOAD_SENTINEL",
      );
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(
        "/secret/location",
      );
    }
  });

  it.each(["", ":memory:", "file::memory:?cache=shared", "bad\0path"])(
    "rejects invalid audit path %j",
    (path) => {
      expect(() => inspectSQLitePhysicalIntegrity(path)).toThrowError(CycleStoreProviderError);
    },
  );
});
