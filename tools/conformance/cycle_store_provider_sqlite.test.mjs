import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as core from "../../packages/core/dist/index.js";
import * as runtime from "../../packages/runtime/dist/index.js";
import { SQLiteCycleStoreProvider } from "../../packages/sqlite/dist/sqlite-cycle-store.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "../../packages/sqlite/dist/sqlite-profile.js";
import {
  createMemoryCycleStoreConformanceHarness,
  exerciseCycleStoreProviderCampaign,
} from "./cycle_store_provider.mjs";
import { createSQLiteCycleStoreConformanceHarness } from "./sqlite_cycle_store_harness.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../../spec/conformance/cycle-store-provider.case.json", import.meta.url),
  "utf8",
));

function normalizedProviderReport(report) {
  const normalized = structuredClone(report);
  normalized.descriptorHash = "<provider-descriptor-hash>";
  for (const result of normalized.caseResults) {
    if (result.id === "descriptor-reference") {
      result.observation.descriptorHash = "<provider-descriptor-hash>";
      result.observation.durability = "<provider-durability>";
    }
    if (result.id === "schema-inspection") {
      result.observation.descriptorHash = "<provider-descriptor-hash>";
    }
  }
  return normalized;
}

test("SQLite passes all 54 provider cases and differs only by truthful profile", async () => {
  const sqliteHarness = createSQLiteCycleStoreConformanceHarness({
    runtime,
    core,
    SQLiteCycleStoreProvider,
  });
  const [memory, sqlite] = await Promise.all([
    exerciseCycleStoreProviderCampaign({
      runtime,
      core,
      fixture,
      harness: createMemoryCycleStoreConformanceHarness(runtime),
    }),
    exerciseCycleStoreProviderCampaign({ runtime, core, fixture, harness: sqliteHarness }),
  ]);

  assert.equal(sqlite.caseCount, 54);
  assert.equal(sqlite.attackCaseCount, 28);
  assert.equal(sqlite.behaviorCaseCount, 26);
  assert.equal(sqlite.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
  assert.deepEqual(sqlite.aggregateFinalState, {
    streams: 44,
    records: 70,
    recordIds: 70,
    checkpoints: 6,
    leaseStreams: 12,
    idempotencyEntries: 74,
    cursors: 4,
    legalHolds: 1,
    migrationFence: 4,
  });
  assert.equal(
    core.canonicalSerialize(normalizedProviderReport(sqlite)),
    core.canonicalSerialize(normalizedProviderReport(memory)),
  );

  const root = fileURLToPath(new URL("../..", import.meta.url));
  const python = spawnSync(
    "uv",
    [
      "run",
      "--project",
      "python",
      "python",
      "tools/conformance/python_sqlite_cycle_store_provider_report.py",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(
    python.status,
    0,
    `Python SQLite provider campaign failed:\n${python.stderr || python.stdout}`,
  );
  const pythonSQLite = JSON.parse(python.stdout);
  assert.deepEqual(
    sqlite,
    pythonSQLite,
    "TypeScript and Python SQLite provider campaign reports differ",
  );
});
