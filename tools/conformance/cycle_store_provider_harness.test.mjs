import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as core from "../../packages/core/dist/index.js";
import * as runtime from "../../packages/runtime/dist/index.js";
import {
  createMemoryCycleStoreConformanceHarness,
  exerciseCycleStoreProviderCampaign,
} from "./cycle_store_provider.mjs";

const fixture = JSON.parse(await readFile(
  new URL("../../spec/conformance/cycle-store-provider.case.json", import.meta.url),
  "utf8",
));

test("provider factory runs every scenario in isolation and cleans every replacement", async () => {
  const memory = createMemoryCycleStoreConformanceHarness(runtime);
  let created = 0;
  let cleaned = 0;
  const harness = {
    async createProvider(options) {
      created += 1;
      const instance = await memory.createProvider(options);
      let closed = false;
      return {
        ...instance,
        cleanup: async () => {
          assert.equal(closed, false, "one harness instance was cleaned twice");
          closed = true;
          cleaned += 1;
          await instance.cleanup();
        },
      };
    },
  };

  const report = await exerciseCycleStoreProviderCampaign({ runtime, core, fixture, harness });
  assert.equal(report.caseCount, 54);
  assert.equal(report.caseResults.length, 54);
  assert.equal(created, 57);
  assert.equal(cleaned, created);
});

test("an invalid test-control surface is rejected and still cleaned", async () => {
  let cleaned = 0;
  const provider = new runtime.MemoryCycleStoreProvider();
  const harness = {
    async createProvider() {
      return {
        provider,
        controls: { stateCounters: () => provider.unsafeStateCountersForTest() },
        cleanup: async () => { cleaned += 1; },
      };
    },
  };
  await assert.rejects(
    exerciseCycleStoreProviderCampaign({ runtime, core, fixture, harness }),
    /provider test control advanceClock is missing/u,
  );
  assert.equal(cleaned, 1);
});
