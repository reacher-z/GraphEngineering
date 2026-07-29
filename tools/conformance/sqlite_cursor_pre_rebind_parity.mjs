#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixturePath = join(root, "spec", "conformance", "sqlite-cursor-pre-rebind-v1.case.json");
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const allowRemaining = process.argv.includes("--allow-remaining");
const harnessOnly = process.argv.includes("--harness-only");
const obligationGroups = [
  fixture.pristineObligations?.scenarios,
  fixture.hostileObligations?.scenarios,
  fixture.lifecycleObligations?.scenarios,
];
assert.ok(obligationGroups.every(Array.isArray), "fixture obligation groups must be arrays");
const obligationNames = obligationGroups.flat().map((item) => item.name);
assert.equal(obligationNames.length, 70, "fixture must freeze exactly 70 B2 obligations");
assert.equal(new Set(obligationNames).size, 70, "fixture obligation names must be globally unique");
const obligationGroupByName = new Map(obligationGroups.flatMap((group, index) =>
  group.map((item) => [item.name, ["pristine", "hostile", "lifecycle"][index]])));

function childProcessFailure(label, child) {
  const output = [child.stdout, child.stderr].filter(Boolean).join("\n--- stderr ---\n");
  const termination = `status=${child.status ?? "null"}, signal=${child.signal ?? "none"}`;
  const systemError = child.error === undefined ? "" : `, error=${child.error.message}`;
  return new Error(
    `${label} failed (${termination}${systemError})${output ? `:\n${output}` : ""}`,
  );
}

function terminateTimedOutProcessGroup(child) {
  if (child.error?.code !== "ETIMEDOUT" || !Number.isInteger(child.pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

let executionCoverage = null;
if (!harnessOnly) {
  const coverage = spawnSync(
    "node", ["tools/conformance/sqlite_cursor_pre_rebind_coverage_validate.mjs"],
    {
      cwd: root,
      detached: process.platform !== "win32",
      encoding: "utf8",
      // The child owns 20-minute TypeScript and 35-minute Python budgets.
      // Preserve five minutes for its structured report and finally cleanup.
      timeout: 60 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  terminateTimedOutProcessGroup(coverage);
  if (coverage.error !== undefined) {
    throw childProcessFailure("SQLite cursor execution coverage", coverage);
  }
  if (coverage.status !== 0) throw childProcessFailure("SQLite cursor execution coverage", coverage);
  const coverageReport = JSON.parse(coverage.stdout);
  assert.equal(coverageReport.status, "coverage-execution-complete");
  assert.ok(coverageReport.execution, "coverage execution report is required");
  executionCoverage = Object.fromEntries(["typescript", "python"].map((runtime) => {
    const evidence = coverageReport.execution.runtimes[runtime];
    assert.ok(evidence, `${runtime} execution coverage is required`);
    assert.equal(evidence.requiredCount, obligationNames.length);
    assert.equal(evidence.executedCount, obligationNames.length);
    assert.deepEqual(evidence.executedCaseIds, [...obligationNames].sort());
    assert.equal(evidence.executedCaseIdsSha256, coverageReport.execution.requiredCaseIdsSha256);
    const executionIds = evidence.executionIds;
    assert.ok(executionIds, `${runtime} execution ID evidence is required`);
    assert.equal(executionIds.missingExecutionIds.length, 0);
    assert.equal(executionIds.unexpectedExecutionIds.length, 0);
    assert.equal(executionIds.actualCount, executionIds.requiredCount);
    assert.equal(executionIds.actualExecutionIdsSha256, executionIds.requiredExecutionIdsSha256);
    assert.equal(executionIds.matchedCount, executionIds.requiredCount);
    assert.equal(executionIds.matchedExecutionIdsSha256, executionIds.requiredExecutionIdsSha256);
    const groups = Object.fromEntries(["pristine", "hostile", "lifecycle"].map((group) => {
      const requiredCaseIds = obligationNames
        .filter((name) => obligationGroupByName.get(name) === group).sort();
      const executedCaseIds = evidence.executedCaseIds.filter(
        (name) => obligationGroupByName.get(name) === group,
      ).sort();
      assert.deepEqual(executedCaseIds, requiredCaseIds, `${runtime} ${group} execution differs`);
      const caseIdsSha256 = createHash("sha256")
        .update(JSON.stringify(executedCaseIds)).digest("hex");
      return [group, {
        caseIdsSha256,
        executed: executedCaseIds.length,
        required: requiredCaseIds.length,
      }];
    }));
    return [runtime, {
      caseIdsSha256: evidence.executedCaseIdsSha256,
      durationMs: coverageReport.execution.durationMs,
      executed: evidence.executedCount,
      executionIds: {
        matched: executionIds.matchedCount,
        required: executionIds.requiredCount,
        sha256: executionIds.matchedExecutionIdsSha256,
      },
      groups,
      required: evidence.requiredCount,
    }];
  }));
}

const sourceFiles = [
  "cursor-pre-rebind-contract",
  "operation-baseline-cursor-inspection",
  "operation-baseline-cursor-invariants",
];
for (const name of sourceFiles) {
  const source = join(root, "packages", "sqlite", "src", `${name}.ts`);
  const built = join(root, "packages", "sqlite", "dist", `${name}.js`);
  try {
    assert.ok(
      statSync(built).mtimeMs >= statSync(source).mtimeMs,
      `${built} is stale; build @graph-engineering/sqlite before running parity`,
    );
  } catch (error) {
    throw new Error(
      "TypeScript SQLite private modules are not built; run "
        + "`corepack pnpm --filter @graph-engineering/sqlite build`",
      { cause: error },
    );
  }
}

const contract = await import(pathToFileURL(join(
  root, "packages", "sqlite", "dist", "cursor-pre-rebind-contract.js",
)).href);
const inspection = await import(pathToFileURL(join(
  root, "packages", "sqlite", "dist", "operation-baseline-cursor-inspection.js",
)).href);
const invariants = await import(pathToFileURL(join(
  root, "packages", "sqlite", "dist", "operation-baseline-cursor-invariants.js",
)).href);

const PHYSICAL_FIELDS = Object.freeze([
  "tenant_id", "token_hash", "kind", "principal_hash", "authorization_hash",
  "stream_id", "checkpoint_scope", "request_scope_blob", "page_size", "next_position",
  "snapshot_tail_sequence", "snapshot_tail_record_hash", "descriptor_hash",
  "schema_identity_sha256", "snapshot_blob", "created_at_ms", "expires_at_ms",
  "consumed_at_ms",
]);
const INTEGER_FIELDS = new Set([
  "page_size", "next_position", "snapshot_tail_sequence", "created_at_ms",
  "expires_at_ms", "consumed_at_ms",
]);
const RULE_INDEXES = Object.freeze([0, 1, 2, 3, 4, 5, 7, 8, 9]);
const ZERO_VECTOR = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function normalizeSql(value) {
  return value.trim().replace(/[\t\n\v\f\r ]+/gu, " ");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function fixtureCanonicalSha256(value) {
  const copy = structuredClone(value);
  copy.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  return sha256(JSON.stringify(canonicalize(copy)));
}

const canonicalFixtureSha256 = fixtureCanonicalSha256(fixture);
assert.equal(
  canonicalFixtureSha256,
  fixture.parityGates.fixtureCanonicalSha256,
  "fixture canonical SHA-256 differs from its frozen parity gate",
);

function sqlEntry(value) {
  const normalized = normalizeSql(value);
  return Object.freeze({ normalized, sha256: sha256(normalized) });
}

function bytesWire(value) {
  return Object.freeze({ bytesBase64: Buffer.from(value).toString("base64") });
}

function decodeWireValue(value) {
  if (value !== null && typeof value === "object"
      && Object.keys(value).length === 1 && typeof value.bytesBase64 === "string") {
    return Buffer.from(value.bytesBase64, "base64");
  }
  return value;
}

function physicalRow(literal) {
  const materialized = {
    ...literal,
    request_scope_blob: Buffer.from(literal.request_scope_blob_utf8, "utf8"),
    snapshot_blob: Buffer.from(literal.snapshot_blob_utf8, "utf8"),
  };
  return PHYSICAL_FIELDS.map((field) => {
    const value = materialized[field];
    return value !== null && INTEGER_FIELDS.has(field) ? BigInt(value) : value;
  });
}

function mutation(field, value) {
  return Object.freeze({ field, value });
}

const HOSTILE_ROWS = Object.freeze([
  Object.freeze({
    id: "rule-1-authorization", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("principal_hash", "bad")], expectedVector: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-2-scope", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("checkpoint_scope", "unexpected")], expectedVector: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-3-blob", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("request_scope_blob", bytesWire('{"streamId":"stream-alpha", "pageSize":64}'))],
    expectedVector: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-4-position", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("page_size", 0)], expectedVector: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-5-clock", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("expires_at_ms", 1_700_000_000_000)],
    expectedVector: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-6-catalog", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("descriptor_hash", "0".repeat(64))],
    expectedVector: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  }),
  Object.freeze({
    id: "rule-8-shape", vector: "event-empty", literal: "eventEmpty",
    mutations: [mutation("descriptor_hash", bytesWire(Buffer.alloc(32)))],
    expectedVector: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  }),
  Object.freeze({
    id: "rule-9-event-binding", vector: "event-nonempty", literal: "eventNonempty",
    eventLookup: "miss", mutations: [], expectedVector: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  }),
  Object.freeze({
    id: "rule-10-checkpoint-binding", vector: "checkpoint", literal: "checkpoint",
    checkpointLookup: "miss", mutations: [], expectedVector: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  }),
]);

const semanticCases = fixture.semanticVectors.map((vector) => Object.freeze({
  id: `pristine:${vector.name}`,
  vector: vector.name,
  capturedCount: vector.expected.cursorCount,
  expectedVector: vector.expected.vector,
  expectedRootSha256: vector.expected.immutableRootSha256,
  rows: vector.sourceRows.map((literal) => Object.freeze({ literal, mutations: [] })),
}));
const hostileCases = HOSTILE_ROWS.map((item) => Object.freeze({
  id: `hostile:${item.id}`,
  vector: item.vector,
  capturedCount: 1,
  expectedVector: item.expectedVector,
  rows: [Object.freeze({
    literal: item.literal,
    mutations: item.mutations,
    ...(item.eventLookup === undefined ? {} : { eventLookup: item.eventLookup }),
    ...(item.checkpointLookup === undefined ? {} : { checkpointLookup: item.checkpointLookup }),
  })],
}));
hostileCases.splice(6, 0, Object.freeze({
  id: "hostile:rule-7-seal-count",
  vector: "empty",
  capturedCount: 1,
  expectedVector: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  rows: [],
}));
const aggregateRows = HOSTILE_ROWS.map((item, index) => Object.freeze({
  literal: item.literal,
  mutations: [
    mutation("token_hash", (index + 1).toString(16).padStart(64, "0")),
    ...item.mutations,
  ],
  ...(item.eventLookup === undefined ? {} : { eventLookup: item.eventLookup }),
  ...(item.checkpointLookup === undefined ? {} : { checkpointLookup: item.checkpointLookup }),
}));
const aggregateCase = Object.freeze({
  id: "hostile:aggregate-all-ten",
  vector: "event-empty",
  capturedCount: aggregateRows.length + 1,
  expectedVector: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  rows: aggregateRows,
});
const preStageCases = Object.freeze([
  Object.freeze({
    id: "hostile:prestage-source-key-storage",
    vector: "event-empty",
    capturedCount: 1,
    expectedVector: [1, 0, 0, 0, 0, 0, 1, 1, 0, 0],
    rows: [Object.freeze({
      literal: "eventEmpty",
      mutations: [mutation("tenant_id", bytesWire(Buffer.from("tenant-a")))],
    })],
  }),
  Object.freeze({
    id: "hostile:prestage-wrong-arity",
    vector: "event-empty",
    capturedCount: 1,
    expectedVector: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
    rows: [Object.freeze({ literal: "eventEmpty", mutations: [], truncateTo: 17 })],
  }),
]);
const mixedStorageCases = Object.freeze([
  Object.freeze({
    id: "hostile:mixed-kind-storage-authorization",
    vector: "event-empty",
    capturedCount: 1,
    expectedVector: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    rows: [Object.freeze({
      literal: "eventEmpty",
      mutations: [
        mutation("kind", bytesWire(Buffer.from("event"))),
        mutation("principal_hash", "bad"),
      ],
    })],
  }),
]);
const cases = Object.freeze([
  ...semanticCases, ...hostileCases, aggregateCase, ...preStageCases, ...mixedStorageCases,
]);

function vectorByName(name) {
  const value = fixture.semanticVectors.find((item) => item.name === name);
  assert.ok(value, `missing semantic vector ${name}`);
  return value;
}

function caseReport(specification) {
  const vector = vectorByName(specification.vector);
  const events = new Set(vector.eventHistory.map((row) => JSON.stringify([
    row.tenant_id, row.stream_id, row.sequence, row.record_hash,
  ])));
  const checkpoints = new Set(vector.checkpointPutHistory.map((row) => JSON.stringify([
    row.tenant_id, row.checkpoint_scope, row.checkpoint_id, row.summary_blob_utf8,
  ])));
  const inspectedRows = [];
  for (const [index, source] of specification.rows.entries()) {
    const row = physicalRow(fixture.literalRows[source.literal]);
    for (const item of source.mutations ?? []) {
      const value = decodeWireValue(item.value);
      row[PHYSICAL_FIELDS.indexOf(item.field)] = value !== null && INTEGER_FIELDS.has(item.field)
        ? BigInt(value) : value;
    }
    if (source.truncateTo !== undefined) row.length = source.truncateTo;
    inspectedRows.push(inspection.inspectSQLiteCursorRow(row, {
      sourceOrdinal: index + 1,
      sourceDescriptorHash: vector.identities.descriptorHash,
      sourceSchemaIdentitySha256: vector.identities.schemaIdentitySha256,
      providerHighWaterAtMs: vector.clocks.providerHighWaterAtMs,
      eventTailExists: source.eventLookup === "miss" ? () => false
        : (tenant, stream, sequence, recordHash) => events.has(JSON.stringify([
          tenant, stream, sequence, recordHash,
        ])),
      checkpointPutExists: source.checkpointLookup === "miss" ? () => false
        : (tenant, scope, checkpointId, summary) => checkpoints.has(JSON.stringify([
          tenant, scope, checkpointId, summary.toString("utf8"),
        ])),
    }));
  }

  const counts = Array(10).fill(0);
  const stageTuples = [];
  const preStageTuples = [];
  const sealRows = [];
  const rowDigests = [];
  for (const inspected of inspectedRows) {
    if (!inspected.stageable) {
      preStageTuples.push(inspected.stageValues.map((value) =>
        typeof value === "bigint" ? Number(value) : value));
      if (inspected.preStageAuthorization) counts[0] += 1;
      if (inspected.preStageShape) counts[7] += 1;
      continue;
    }
    stageTuples.push(inspected.stageValues.map((value) =>
      typeof value === "bigint" ? Number(value) : value));
    const flags = inspected.stageValues.slice(20, 29).map((value) => value === 1);
    for (const [index, flag] of flags.entries()) if (!flag) counts[RULE_INDEXES[index]] += 1;
    if (inspected.sealRow !== undefined) {
      sealRows.push(inspected.sealRow);
      rowDigests.push(invariants.digestSQLiteCursorSealCarrier(
        inspected.sealRow.carrier,
      ).toString("hex"));
    }
  }
  const walked = inspectedRows.length;
  const staged = stageTuples.length;
  counts[6] = specification.capturedCount !== walked || walked !== staged ? 1 : 0;
  const diagnostics = contract.SQLITE_CURSOR_PRE_REBIND_RULE_ORDER.flatMap((ruleId, index) =>
    counts[index] === 0 ? [] : [{
      ruleId, violationCount: counts[index], diagnosticsTruncated: false,
    }]);
  const clean = counts.every((value) => value === 0);
  let rootSha256 = null;
  const carriers = [];
  if (clean) {
    sealRows.sort((left, right) => Buffer.compare(
      Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash),
    ) || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
    const accumulator = new invariants.SQLiteCursorSealAccumulator(
      specification.capturedCount,
      vector.identities.descriptorHash,
      vector.identities.schemaIdentitySha256,
    );
    for (const sealRow of sealRows) {
      accumulator.append(sealRow);
      carriers.push(sealRow.carrier);
    }
    rootSha256 = accumulator.finish().immutableRootSha256;
  }
  return {
    id: specification.id,
    vector: counts,
    diagnostics,
    preStageTuples,
    stageTuples,
    rowDigests,
    carriers,
    rootSha256,
    outcome: clean ? "pre-rebind-complete" : "diagnosed",
    resourceObservation: {
      walkedRows: walked,
      stagedRows: staged,
      sealEligibleRows: sealRows.length,
      maximumFetchSize: walked === 0 ? 0 : 1,
      maximumLiveRawRows: walked === 0 ? 0 : 1,
      maximumLiveInspections: walked === 0 ? 0 : 1,
    },
  };
}

const remainingEvidence = Object.freeze([
  ...(allowRemaining ? [
    "productionCampaign.maxActiveRegistered",
    "productionCampaign.maxNestedPointLookup",
    "productionCampaign.tempObjectAndPageCounts",
  ] : []),
]);
let productionEvidence = null;
if (!allowRemaining && !harnessOnly) {
  const production = spawnSync(
    "node", ["tools/conformance/sqlite_cursor_pre_rebind_production_evidence.mjs"],
    {
      cwd: root,
      detached: process.platform !== "win32",
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: 12 * 60_000,
    },
  );
  terminateTimedOutProcessGroup(production);
  if (production.error !== undefined) {
    throw childProcessFailure("SQLite cursor production evidence", production);
  }
  if (production.status !== 0) {
    throw childProcessFailure("SQLite cursor production evidence", production);
  }
  productionEvidence = JSON.parse(production.stdout);
}
const typescriptReport = {
  schemaVersion: 1,
  runtime: "typescript",
  fixtureId: fixture.id,
  fixtureSha256: canonicalFixtureSha256,
  contract: {
    diagnosticLimits: {
      minimum: contract.MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
      default: contract.DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
      maximum: contract.MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
    },
    ruleOrder: [...contract.SQLITE_CURSOR_PRE_REBIND_RULE_ORDER],
    sql: {
      source: sqlEntry(contract.SQLITE_CURSOR_SOURCE_QUERY),
      insert: sqlEntry(contract.SQLITE_CURSOR_STAGE_INSERT_SQL),
      seal: sqlEntry(contract.SQLITE_CURSOR_STAGE_SEAL_SQL),
      countMarker: sqlEntry(contract.SQLITE_CURSOR_COUNT_MARKER_SQL),
      eventLookup: sqlEntry(contract.SQLITE_CURSOR_EVENT_LOOKUP_SQL),
      checkpointLookup: sqlEntry(contract.SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL),
      rowMarkers: contract.SQLITE_CURSOR_ROW_RULES.map(({ ruleId, sql }) => ({
        ruleId, ...sqlEntry(sql),
      })),
    },
  },
  cases: cases.map(caseReport),
  remainingEvidence,
};

const python = spawnSync(
  "uv",
  ["run", "--project", "python", "python", "tools/conformance/sqlite_cursor_pre_rebind_parity.py"],
  {
    cwd: root,
    detached: process.platform !== "win32",
    encoding: "utf8",
    input: JSON.stringify({ fixturePath, cases, remainingEvidence }),
    maxBuffer: 16 * 1024 * 1024,
    timeout: 5 * 60_000,
  },
);
terminateTimedOutProcessGroup(python);
if (python.error !== undefined) {
  throw childProcessFailure("Python SQLite cursor parity report", python);
}
if (python.status !== 0) {
  throw childProcessFailure("Python SQLite cursor parity report", python);
}
const pythonReport = JSON.parse(python.stdout);
const comparableTypeScript = { ...typescriptReport, runtime: undefined };
const comparablePython = { ...pythonReport, runtime: undefined };

function parityDifferences(left, right, path = "$", differences = []) {
  if (differences.length >= 40 || Object.is(left, right)) return differences;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    differences.push({ path, python: left, typescript: right });
    return differences;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    differences.push({ path, python: left, typescript: right });
    return differences;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of [...keys].sort()) {
    if (!(key in left) || !(key in right)) {
      differences.push({
        path: `${path}.${key}`,
        python: key in left ? left[key] : "<missing>",
        typescript: key in right ? right[key] : "<missing>",
      });
    } else {
      parityDifferences(left[key], right[key], `${path}.${key}`, differences);
    }
    if (differences.length >= 40) break;
  }
  return differences;
}

const fixtureSql = fixture.sqlContract;
for (const name of ["source", "insert", "seal", "countMarker", "eventLookup", "checkpointLookup"]) {
  assert.equal(typescriptReport.contract.sql[name].normalized, fixtureSql[name].sql, `${name} SQL differs`);
  assert.equal(typescriptReport.contract.sql[name].sha256, fixtureSql[name].sha256, `${name} hash differs`);
}
assert.deepEqual(
  typescriptReport.contract.sql.rowMarkers.map(({ ruleId, sha256: digest }) => ({ ruleId, sha256: digest })),
  fixtureSql.rowMarkers.map(({ ruleId, sha256: digest }) => ({ ruleId, sha256: digest })),
  "row-marker hashes differ from the fixture",
);
for (const [index, specification] of cases.entries()) {
  const observed = typescriptReport.cases[index];
  const pythonObserved = pythonReport.cases[index];
  assert.equal(observed.id, specification.id);
  assert.equal(pythonObserved.id, specification.id);
  assert.deepEqual(observed.vector, specification.expectedVector,
    `${specification.id}: TypeScript vector differs`);
  assert.deepEqual(pythonObserved.vector, specification.expectedVector,
    `${specification.id}: Python vector differs`);
  if (specification.expectedRootSha256 !== undefined) {
    assert.equal(
      observed.rootSha256,
      specification.expectedRootSha256,
      `${specification.id}: TypeScript root differs`,
    );
    assert.equal(
      pythonObserved.rootSha256,
      specification.expectedRootSha256,
      `${specification.id}: Python root differs`,
    );
  }
}
assert.deepEqual(typescriptReport.contract.ruleOrder, fixture.ruleOrder);
assert.deepEqual(typescriptReport.contract.diagnosticLimits, {
  minimum: fixture.resourceLimits.diagnosticMinimum,
  default: fixture.resourceLimits.diagnosticDefault,
  maximum: fixture.resourceLimits.diagnosticMaximum,
});

const summary = {
  mode: harnessOnly ? "harness-only" : "complete",
  fixtureId: fixture.id,
  fixtureSha256: typescriptReport.fixtureSha256,
  fixtureObligations: {
    pristineRequired: fixture.pristineObligations.scenarios.length,
    hostileRequired: fixture.hostileObligations.scenarios.length,
    lifecycleRequired: fixture.lifecycleObligations.scenarios.length,
    totalRequired: fixture.pristineObligations.scenarios.length
      + fixture.hostileObligations.scenarios.length
      + fixture.lifecycleObligations.scenarios.length,
    executionRegistryVerified: !harnessOnly,
    productionEvidenceVerified: productionEvidence !== null,
  },
  harnessEvidence: {
    semanticCasesExecuted: semanticCases.length,
    hostileRuleCasesExecuted: hostileCases.length + 1,
    preStageCasesExecuted: preStageCases.length,
    preStageCases: preStageCases.map((item) => ({
      id: item.id,
      expectedVector: item.expectedVector,
    })),
    mixedStorageCasesExecuted: mixedStorageCases.length,
    mixedStorageCases: mixedStorageCases.map((item) => ({
      id: item.id,
      expectedVector: item.expectedVector,
    })),
    lifecycleCasesExecuted: 0,
    totalCasesExecuted: cases.length,
  },
  executionCoverage,
  comparedStageTuples: typescriptReport.cases.reduce(
    (count, item) => count + item.stageTuples.length, 0,
  ),
  comparedPreStageTuples: typescriptReport.cases.reduce(
    (count, item) => count + item.preStageTuples.length, 0,
  ),
  comparedRowDigests: typescriptReport.cases.reduce(
    (count, item) => count + item.rowDigests.length, 0,
  ),
  parityDifferences: parityDifferences(comparablePython, comparableTypeScript),
  productionEvidence,
  remainingEvidence,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.parityDifferences.length !== 0) {
  throw new Error(
    `SQLite cursor cross-runtime parity differs at ${summary.parityDifferences.length} `
      + "reported path(s); see the bounded difference list above.",
  );
}
