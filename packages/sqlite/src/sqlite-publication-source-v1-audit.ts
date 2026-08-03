import { createHash } from "node:crypto";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_CYCLE_STORE_SCHEMA_VERSION,
  SQLITE_SCHEMA_IDENTITY_SHA256,
} from "./migrations.js";
import { inspectSQLiteCycleStoreIntegrity } from "./semantic-integrity.js";

const reflectApplyIntrinsic = Reflect.apply;
const arrayIsArrayIntrinsic = Array.isArray;
const arrayPushIntrinsic = Array.prototype.push;
const jsonStringifyIntrinsic = JSON.stringify;
const stringStartsWithIntrinsic = String.prototype.startsWith;
const bigintToStringIntrinsic = BigInt.prototype.toString;
const databaseExecIntrinsic = DatabaseSync.prototype.exec;
const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseCloseIntrinsic = DatabaseSync.prototype.close;
const statementAllIntrinsic = StatementSync.prototype.all;
const statementSetReadBigIntsIntrinsic = StatementSync.prototype.setReadBigInts;
const statementSetReturnArraysIntrinsic = StatementSync.prototype.setReturnArrays;
const hashProbe = createHash("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;

function corruption(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", "inspect-schema", message);
}

function fullPersistentCatalogSha256(path: string): string {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    reflectApplyIntrinsic(databaseExecIntrinsic, database, [
      "PRAGMA trusted_schema = OFF; PRAGMA query_only = ON; BEGIN",
    ]);
    const statement = reflectApplyIntrinsic(databasePrepareIntrinsic, database, [`
      SELECT type, name, tbl_name, rootpage, sql
        FROM main.sqlite_schema
       WHERE type IN ('table', 'index', 'trigger', 'view')
         AND substr(lower(name), 1, 7) <> 'sqlite_'
       ORDER BY type COLLATE BINARY, name COLLATE BINARY
    `]) as StatementSync;
    reflectApplyIntrinsic(statementSetReturnArraysIntrinsic, statement, [true]);
    reflectApplyIntrinsic(statementSetReadBigIntsIntrinsic, statement, [true]);
    const rows = reflectApplyIntrinsic(statementAllIntrinsic, statement, []) as unknown as
      readonly (readonly unknown[])[];
    const canonical: unknown[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!reflectApplyIntrinsic(arrayIsArrayIntrinsic, Array, [row]) || row?.length !== 5
          || typeof row[0] !== "string" || typeof row[1] !== "string"
          || typeof row[2] !== "string" || typeof row[3] !== "bigint"
          || typeof row[4] !== "string") {
        return corruption("persistent sqlite_schema row is invalid");
      }
      if ((row[0] !== "table" && row[0] !== "index")
          || !reflectApplyIntrinsic(stringStartsWithIntrinsic, row[1], ["ge_cycle_"])) {
        return corruption("persistent sqlite_schema contains an object outside source-v1");
      }
      reflectApplyIntrinsic(arrayPushIntrinsic, canonical, [[
          row[0],
          row[1],
          row[2],
          reflectApplyIntrinsic(bigintToStringIntrinsic, row[3], []),
          row[4],
        ]]);
    }
    reflectApplyIntrinsic(databaseExecIntrinsic, database, ["COMMIT"]);
    const hash = createHash("sha256");
    reflectApplyIntrinsic(hashUpdateIntrinsic, hash, [
      reflectApplyIntrinsic(jsonStringifyIntrinsic, JSON, [canonical]),
      "utf8",
    ]);
    return reflectApplyIntrinsic(hashDigestIntrinsic, hash, ["hex"]) as string;
  } finally {
    if (database !== undefined) reflectApplyIntrinsic(databaseCloseIntrinsic, database, []);
  }
}

/** Exact semantic plus closed persistent-catalog identity for one source-v1 file. */
export function auditSQLitePublicationSourceV1(path: string): string {
  const report = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  if (report.semanticSha256 === null) return corruption("source-v1 audit is incomplete");
  if (report.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID
      || report.schemaVersion !== SQLITE_CYCLE_STORE_SCHEMA_VERSION
      || report.schemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256) {
    return corruption("database is not exact source-v1");
  }
  return reflectApplyIntrinsic(jsonStringifyIntrinsic, JSON, [[
    report.applicationId,
    report.schemaVersion,
    report.schemaIdentitySha256,
    report.descriptorHash,
    report.catalogSha256,
    report.lineageId,
    report.lineageSha256,
    report.semanticSha256,
    report.counters,
    fullPersistentCatalogSha256(path),
  ]]) as string;
}
