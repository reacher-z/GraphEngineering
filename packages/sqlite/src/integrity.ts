import { DatabaseSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { hardenSQLiteStatement, sqliteRow, sqliteText } from "./sqlite-codec.js";
import { translateSQLiteError } from "./sqlite-errors.js";

export interface SQLitePhysicalIntegrityReport {
  readonly quickCheck: "ok";
  readonly integrityCheck: "ok";
  readonly foreignKeyViolations: 0;
  readonly sqliteVersion: string;
}

function checkedAuditPath(value: unknown): string {
  if (typeof value !== "string"
      || value.length === 0
      || value.includes("\0")
      || value === ":memory:"
      || value.startsWith("file::memory:")) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite audit path is invalid",
    );
  }
  return value;
}

function checkRows(
  database: DatabaseSync,
  pragma: "quick_check" | "integrity_check",
): void {
  const rows = hardenSQLiteStatement(database.prepare(`PRAGMA ${pragma}`)).all();
  if (rows.length !== 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite physical integrity check failed",
      { check: pragma },
    );
  }
  const value = sqliteText(
    sqliteRow(rows[0], 1, "inspect-schema", pragma)[0],
    "inspect-schema",
    pragma,
  );
  if (value !== "ok") {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite physical integrity check failed",
      { check: pragma },
    );
  }
}

/**
 * Opens an independent read-only handle and verifies SQLite's physical and
 * relational invariants. Application hash-chain and ledger audits are layered
 * on top by the CycleStore provider.
 */
export function inspectSQLitePhysicalIntegrity(path: string): SQLitePhysicalIntegrityReport {
  const safePath = checkedAuditPath(path);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(safePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    checkRows(database, "quick_check");
    checkRows(database, "integrity_check");
    const foreignKeyRows = hardenSQLiteStatement(
      database.prepare("PRAGMA foreign_key_check"),
    ).all();
    if (foreignKeyRows.length !== 0) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite foreign-key integrity check failed",
        { violations: foreignKeyRows.length },
      );
    }
    const version = sqliteText(
      sqliteRow(
        hardenSQLiteStatement(database.prepare("SELECT sqlite_version()" )).get(),
        1,
        "inspect-schema",
        "SQLite version",
      )[0],
      "inspect-schema",
      "SQLite version",
    );
    return Object.freeze({
      quickCheck: "ok",
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      sqliteVersion: version,
    });
  } catch (error) {
    throw translateSQLiteError(error, "inspect-schema");
  } finally {
    if (database?.isOpen === true) database.close();
  }
}
