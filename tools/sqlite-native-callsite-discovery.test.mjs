import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  scanPythonFilesForTest,
  scanRepository,
} from "./sqlite-native-callsite-discovery.mjs";

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function hostileWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ge-sqlite-discovery-"));
  fs.writeFileSync(path.join(root, "sample.ts"), `
    import { DatabaseSync as NativeDatabase } from "node:sqlite";
    import { SQLiteConnection as WrapperConnection } from "./sqlite-connection.js";
    declare class Database { prepare(sql: string): any; exec(sql: string): void }
    declare const unknownSql: string;
    declare const table: string;
    declare const methodName: string;
    declare function unresolved(): unknown;
    const database = new NativeDatabase(":memory:");
    declare const wrapper: WrapperConnection;
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
    /not sqlite/u.exec("SELECT 7");
    const fake = new Database();
    fake.exec("SELECT 8");
    wrapper.prepare("SELECT 11");
    function shadow(database) { database.prepare("SELECT 9"); }
    let poisonedAlias = databaseAlias;
    poisonedAlias = unresolved();
    poisonedAlias.prepare("SELECT 10");
    class DerivedNative extends NativeDatabase {
      inspect() {
        this.exec("SELECT 12");
        function nested() { this.exec("SELECT 24"); }
        const arrow = () => this.exec("SELECT 25");
      }
      static inspectStatic() { this.exec("SELECT 23"); }
    }
    new DerivedNative(":memory:").exec("SELECT 13");
    class DerivedWrapper extends WrapperConnection {
      inspect() { this.prepare("SELECT 14"); }
    }
    new DerivedWrapper({} as never).prepare("SELECT 15");
    class OrdinaryBase {}
    class DerivedUnknown extends OrdinaryBase {
      inspect() { this.exec("SELECT 16"); }
    }
    new DerivedUnknown().exec("SELECT 17");
    interface LocalDatabaseShape { exec(sql: string): void }
    declare const structural: LocalDatabaseShape;
    structural.exec("SELECT 18");
    class Ordinary {
      inspect() { this.exec("SELECT 19"); }
    }
    new Ordinary().exec("SELECT 20");
    ("literal" as string).exec("SELECT 21");
    ({ exec(_sql: string) {} }).exec("SELECT 22");
    function one() {
      class Colliding extends NativeDatabase {}
      new Colliding(":memory:").exec("SELECT 26");
    }
    function two() {
      class Colliding {}
      new Colliding().exec("SELECT 27");
    }
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

test("scanner follows only evidence-backed TypeScript receiver aliases and keeps hostile candidates", (t) => {
  const root = hostileWorkspace();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const report = scanRepository({ root, fixture: "routes.json", typescript: ["sample.ts"], python: [] });
  assert.equal(report.routeClosureClaimed, false);
  assert.equal(report.policy.dynamicOrUnresolvedSql, "unknown");
  assert.deepEqual(report.policy.typescriptReceiverEvidence, {
    aliasPropagation: "proven-only",
    nameHintsIncreaseConfidence: false,
    unknownCandidatesDropped: false,
  });
  assert.ok(report.callsites.some(({ fixtureClassificationCandidate, fixtureMatches, receiverConfidence, receiverFamily, routeClassification, sqlEvidence, typescriptClassification }) =>
    receiverConfidence === "proven"
    && receiverFamily === "native"
    && sqlEvidence.sha256 === digest("SELECT 1")
    && fixtureClassificationCandidate === "authenticated-fixed-read"
    && fixtureMatches.length === 1
    && routeClassification === "unknown"
    && typescriptClassification.disposition === "confirmed-native-receiver"));
  assert.ok(report.callsites.some(({ methodAlias, method, sqlEvidence }) => methodAlias && method === "prepare" && sqlEvidence.status === "exact"));
  assert.ok(report.callsites.some(({ method, sqlEvidence }) => method === "exec" && sqlEvidence.shape === "interpolated-template" && sqlEvidence.status === "dynamic"));
  assert.ok(report.callsites.some(({ method, receiverConfidence, receiverEvidenceAliasDepth, receiverFamily, sqlEvidence }) =>
    method === "prepare"
    && receiverConfidence === "proven"
    && receiverEvidenceAliasDepth > 0
    && receiverFamily === "native"
    && sqlEvidence.shape === "static-template"));
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
  assert.ok(report.callsites.some(({ sqlEvidence, typescriptClassification }) =>
    sqlEvidence.sha256 === digest("SELECT 7")
    && typescriptClassification.disposition === "false-positive"));
  assert.ok(report.callsites.some(({ receiverConfidence, sqlEvidence, typescriptClassification }) =>
    receiverConfidence === "unknown"
    && sqlEvidence.sha256 === digest("SELECT 8")
    && typescriptClassification.disposition === "unknown"));
  assert.ok(report.callsites.some(({ receiverFamily, sqlEvidence, typescriptClassification }) =>
    receiverFamily === "wrapper"
    && sqlEvidence.sha256 === digest("SELECT 11")
    && typescriptClassification.disposition === "wrapper-guard-or-test-like-production-probe"));
  for (const sql of ["SELECT 9", "SELECT 10"]) {
    assert.ok(report.callsites.some(({ receiverConfidence, sqlEvidence, typescriptClassification }) =>
      receiverConfidence === "unknown"
      && sqlEvidence.sha256 === digest(sql)
      && typescriptClassification.disposition === "unknown"));
  }
  for (const sql of ["SELECT 12", "SELECT 13", "SELECT 25"]) {
    assert.ok(report.callsites.some(({ receiverConfidence, receiverFamily, sqlEvidence, typescriptClassification }) =>
      receiverConfidence === "proven"
      && receiverFamily === "native"
      && sqlEvidence.sha256 === digest(sql)
      && typescriptClassification.disposition === "confirmed-native-receiver"));
  }
  for (const sql of ["SELECT 14", "SELECT 15"]) {
    assert.ok(report.callsites.some(({ receiverConfidence, receiverFamily, sqlEvidence, typescriptClassification }) =>
      receiverConfidence === "proven"
      && receiverFamily === "wrapper"
      && sqlEvidence.sha256 === digest(sql)
      && typescriptClassification.disposition === "wrapper-guard-or-test-like-production-probe"));
  }
  for (const sql of [
    "SELECT 16",
    "SELECT 17",
    "SELECT 18",
    "SELECT 19",
    "SELECT 20",
    "SELECT 23",
    "SELECT 24",
    "SELECT 26",
    "SELECT 27",
  ]) {
    assert.ok(report.callsites.some(({ receiverConfidence, sqlEvidence, typescriptClassification }) =>
      receiverConfidence === "unknown"
      && sqlEvidence.sha256 === digest(sql)
      && typescriptClassification.disposition === "unknown"));
  }
  for (const sql of ["SELECT 21", "SELECT 22"]) {
    assert.ok(report.callsites.some(({ receiverConfidence, receiverFamily, sqlEvidence, typescriptClassification }) =>
      receiverConfidence === "proven"
      && receiverFamily === "non-sqlite"
      && sqlEvidence.sha256 === digest(sql)
      && typescriptClassification.disposition === "false-positive"));
  }
  assert.equal(report.callsites.some(({ receiverConfidence }) => receiverConfidence === "heuristic"), false);
  assert.equal(report.callsites.every(({ stableIdentity }) =>
    typeof stableIdentity.path === "string"
    && Number.isInteger(stableIdentity.line)
    && typeof stableIdentity.method === "string"
    && typeof stableIdentity.sqlOrigin === "string"
    && /^[0-9a-f]{64}$/u.test(stableIdentity.sha256)), true);
  assert.equal(new Set(report.callsites.map(({ stableIdentity }) => stableIdentity.sha256)).size, report.callsites.length);
  assert.equal(Object.values(report.summary.typescriptCallsiteClassifications)
    .reduce((total, count) => total + count, 0), report.summary.byLanguage.typescript);
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
  assert.equal(JSON.stringify(second), JSON.stringify(first));
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

test("Python scanner subprocess envelope fails closed on every failure channel", () => {
  const clean = {
    error: undefined,
    signal: null,
    status: 0,
    stderr: "",
    stdout: "[]",
  };
  assert.deepEqual(scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => clean), []);
  assert.throws(
    () => scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => ({
      ...clean,
      error: new Error("spawn denied"),
    })),
    /spawn failed: spawn denied/u,
  );
  assert.throws(
    () => scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => ({
      ...clean,
      signal: "SIGKILL",
      status: null,
    })),
    /signal SIGKILL/u,
  );
  assert.throws(
    () => scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => ({
      ...clean,
      status: 23,
    })),
    /status 23/u,
  );
  assert.throws(
    () => scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => ({
      ...clean,
      stderr: "warning despite valid stdout",
    })),
    /wrote stderr despite success/u,
  );
  assert.throws(
    () => scanPythonFilesForTest(["/fixture/sample.py"], "/fixture", () => ({
      ...clean,
      stdout: "not-json",
    })),
    /invalid JSON/u,
  );
});

test("explicit scanner inputs are canonical contained regular files", (t) => {
  const root = hostileWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ge-sqlite-discovery-outside-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  t.after(() => fs.rmSync(outside, { force: true, recursive: true }));
  fs.mkdirSync(path.join(root, "nested"));
  const outsideTs = path.join(outside, "outside.ts");
  const outsideFixture = path.join(outside, "outside.json");
  fs.writeFileSync(outsideTs, "mystery.exec('SELECT outside');\n");
  fs.writeFileSync(outsideFixture, "{}\n");
  fs.symlinkSync(outsideTs, path.join(root, "outside-link.ts"));
  fs.symlinkSync(path.join(root, "sample.ts"), path.join(root, "sample-link.ts"));
  fs.symlinkSync(outsideFixture, path.join(root, "fixture-link.json"));

  const valid = scanRepository({
    root,
    fixture: "routes.json",
    typescript: ["sample.ts"],
    python: [],
  });
  assert.deepEqual(valid.inputs.typescriptFiles, ["sample.ts"]);
  assert.equal(valid.inputs.fixture, "routes.json");

  const invalidTypeScript = [
    "./sample.ts",
    "nested/../sample.ts",
    "../outside.ts",
    path.join(root, "sample.ts"),
    "nested",
    "missing.ts",
    "outside-link.ts",
    "sample-link.ts",
  ];
  for (const input of invalidTypeScript) {
    assert.throws(() => scanRepository({
      root,
      fixture: "routes.json",
      typescript: [input],
      python: [],
    }), /TypeScript path/u, input);
  }
  assert.throws(() => scanRepository({
    root,
    fixture: "routes.json",
    typescript: ["sample.ts", "sample.ts"],
    python: [],
  }), /duplicate files/u);
  assert.throws(() => scanRepository({
    root,
    fixture: "routes.json",
    typescript: [],
    python: ["./sample.py"],
  }), /Python path/u);

  for (const fixture of [
    "./routes.json",
    "nested/../routes.json",
    path.relative(root, outsideFixture),
    path.join(root, "routes.json"),
    "nested",
    "missing.json",
    "fixture-link.json",
  ]) {
    assert.throws(() => scanRepository({
      root,
      fixture,
      typescript: ["sample.ts"],
      python: [],
    }), /Fixture path/u, fixture);
  }
});

test("files and callsites use Python-compatible Unicode code-point order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ge-sqlite-unicode-order-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const names = ["Z.ts", "a.ts", "\uFFFD.ts", "😀.ts"];
  for (const name of names) {
    fs.writeFileSync(path.join(root, name), `
      import { DatabaseSync } from "node:sqlite";
      new DatabaseSync(":memory:").exec(${JSON.stringify(`SELECT ${name}`)});
    `);
  }
  const report = scanRepository({
    root,
    fixture: null,
    typescript: [...names].reverse(),
    python: [],
  });
  assert.deepEqual(report.inputs.typescriptFiles, names);
  assert.deepEqual(report.callsites.map(({ path: callsitePath }) => callsitePath), names);
});
