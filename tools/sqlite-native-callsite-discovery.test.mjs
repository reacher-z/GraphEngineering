import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanRepository } from "./sqlite-native-callsite-discovery.mjs";

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function hostileWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ge-sqlite-discovery-"));
  fs.writeFileSync(path.join(root, "sample.ts"), `
    declare class DatabaseSync { prepare(sql: string): any; exec(sql: string): void }
    declare const unknownSql: string;
    declare const table: string;
    declare const methodName: string;
    const database = new DatabaseSync();
    const exactSql = "SELECT 1";
    database.prepare(exactSql).get();
    const databaseAlias = database;
    databaseAlias.exec(\`INSERT INTO \${table} VALUES (1)\`);
    const prepareAlias = database.prepare;
    prepareAlias("SELECT 2");
    const holder = { db: database };
    holder.db.prepare(\`SELECT 3\`).all();
    database.prepare(unknownSql).run();
    mystery.prepare(\`SELECT \${table}\`);
    mystery.prepare("SELECT 1").get();
    database[methodName]("SELECT 6");
  `);
  fs.writeFileSync(path.join(root, "sample.py"), `
import sqlite3

def inspect(connection: sqlite3.Connection, table: str, unknown_sql: str) -> None:
    local_sql = "SELECT 1"
    connection.execute(local_sql)
    connection_alias = connection
    connection_alias.execute("SELECT 4")
    cursor = connection.cursor()
    execute_alias = cursor.execute
    execute_alias(f"SELECT * FROM {table}")
    holder.connection.execute("SELECT 5")
    connection.execute(unknown_sql)
    getattr(connection, table)("SELECT 6")
    mystery.execute("SELECT 1").run()
`);
  fs.writeFileSync(path.join(root, "routes.json"), JSON.stringify({
    routes: [{ classification: "authenticated-fixed-read", id: "known.select-one", sqlSha256: digest("SELECT 1") }],
    routeClosureClaimedByThisArtifact: false,
  }));
  return root;
}

test("scanner follows TypeScript templates, receiver aliases, method aliases, and member calls conservatively", (t) => {
  const root = hostileWorkspace();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = scanRepository({ root, fixture: "routes.json", typescript: ["sample.ts"], python: [] });
  assert.equal(report.routeClosureClaimed, false);
  assert.equal(report.policy.dynamicOrUnresolvedSql, "unknown");
  assert.ok(report.callsites.some(({ fixtureClassificationCandidate, fixtureMatches, receiverConfidence, routeClassification, sqlEvidence }) =>
    receiverConfidence === "proven"
    && sqlEvidence.sha256 === digest("SELECT 1")
    && fixtureClassificationCandidate === "authenticated-fixed-read"
    && fixtureMatches.length === 1
    && routeClassification === "unknown"));
  assert.ok(report.callsites.some(({ methodAlias, method, sqlEvidence }) => methodAlias && method === "prepare" && sqlEvidence.status === "exact"));
  assert.ok(report.callsites.some(({ method, sqlEvidence }) => method === "exec" && sqlEvidence.shape === "interpolated-template" && sqlEvidence.status === "dynamic"));
  assert.ok(report.callsites.some(({ method, receiverConfidence, sqlEvidence }) => method === "prepare" && receiverConfidence === "heuristic" && sqlEvidence.shape === "static-template"));
  assert.ok(report.callsites.some(({ method, receiverConfidence, sqlEvidence }) => method === "prepare" && receiverConfidence === "unknown" && sqlEvidence.status === "dynamic"));
  const unknownExactPrepare = report.callsites.find(({ fixtureClassificationCandidate, method, receiverConfidence, routeClassification, sqlEvidence }) =>
    method === "prepare"
    && receiverConfidence === "unknown"
    && sqlEvidence.sha256 === digest("SELECT 1")
    && fixtureClassificationCandidate === "authenticated-fixed-read"
    && routeClassification === "unknown");
  assert.ok(unknownExactPrepare);
  assert.equal(report.callsites.some(({ line, method }) => method === "get" && line === unknownExactPrepare.line), false);
  assert.ok(report.callsites.some(({ method, routeClassification, sqlOrigin }) => method === "<computed>" && sqlOrigin === "computed-method" && routeClassification === "unknown"));
  assert.ok(report.callsites.some(({ method, sqlOrigin }) => method === "get" && sqlOrigin === "prepared-statement"));
  for (const callsite of report.callsites.filter(({ sqlEvidence }) => sqlEvidence.status !== "exact")) {
    assert.equal(callsite.routeClassification, "unknown");
    assert.equal(callsite.unknown, true);
  }
  for (const callsite of report.callsites.filter(({ receiverConfidence }) => receiverConfidence !== "proven")) {
    assert.equal(callsite.routeClassification, "unknown");
    assert.equal(callsite.unknown, true);
  }
});

test("scanner follows Python function-local SQL, connection/cursor aliases, f-strings, and attribute members", (t) => {
  const root = hostileWorkspace();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = scanRepository({ root, fixture: "routes.json", typescript: [], python: ["sample.py"] });
  const calls = report.callsites;
  assert.ok(calls.some(({ method, receiverConfidence, routeClassification, sqlEvidence }) =>
    method === "execute" && receiverConfidence === "proven" && sqlEvidence.shape === "identifier-alias" && routeClassification === "unknown"));
  assert.ok(calls.some(({ methodAlias, receiverKind, sqlEvidence }) =>
    methodAlias && receiverKind === "cursor" && sqlEvidence.shape === "interpolated-fstring" && sqlEvidence.status === "dynamic"));
  assert.ok(calls.some(({ method, receiverConfidence, sqlEvidence }) =>
    method === "execute" && receiverConfidence === "heuristic" && sqlEvidence.status === "exact"));
  assert.equal(calls.filter(({ receiverConfidence }) => receiverConfidence !== "proven").every(({ unknown }) => unknown), true);
  assert.ok(calls.some(({ method, sqlEvidence }) =>
    method === "execute" && sqlEvidence.shape === "identifier-alias" && sqlEvidence.status === "unknown"));
  assert.ok(calls.some(({ method, sqlEvidence }) => method === "cursor" && sqlEvidence.status === "absent"));
  const unknownExactExecute = calls.find(({ fixtureClassificationCandidate, method, receiverConfidence, routeClassification, sqlEvidence }) =>
    method === "execute"
    && receiverConfidence === "unknown"
    && sqlEvidence.sha256 === digest("SELECT 1")
    && fixtureClassificationCandidate === "authenticated-fixed-read"
    && routeClassification === "unknown");
  assert.ok(unknownExactExecute);
  assert.equal(calls.some(({ line, method }) => method === "run" && line === unknownExactExecute.line), false);
  assert.ok(calls.some(({ method, routeClassification, sqlOrigin }) => method === "<computed>" && sqlOrigin === "computed-method" && routeClassification === "unknown"));
  assert.ok(calls.filter(({ unknown }) => unknown).length >= 4);
});

test("inventory is deterministic and exact-but-unregistered SQL stays unknown", (t) => {
  const root = hostileWorkspace();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const options = { root, fixture: "routes.json", typescript: ["sample.ts"], python: ["sample.py"] };
  const first = scanRepository(options);
  const second = scanRepository(options);
  assert.deepEqual(second, first);
  assert.equal(first.routeClosureClaimed, false);
  const selectTwo = first.callsites.find(({ sqlEvidence }) => sqlEvidence.sha256 === digest("SELECT 2"));
  assert.ok(selectTwo);
  assert.equal(selectTwo.routeClassification, "unknown");
  assert.equal(selectTwo.unknown, true);
  assert.equal(first.summary.unknownCount > 0, true);
  assert.equal(first.summary.fixtureClassifiedCount, 0);
  assert.equal(first.policy.exactDigestMatchIsAuthorization, false);
  assert.equal(first.summary.callsiteCount, first.callsites.length);
  assert.equal(first.summary.scannedFileCount, 2);
  assert.deepEqual(first.inputs.typescriptFiles, ["sample.ts"]);
  assert.deepEqual(first.inputs.pythonFiles, ["sample.py"]);
});
