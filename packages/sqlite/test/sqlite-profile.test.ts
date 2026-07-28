import { validateCycleStoreProviderDescriptor } from "@graph-engineering/runtime";
import { describe, expect, it } from "vitest";

import {
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  createSQLiteCycleStoreDescriptor,
} from "../src/sqlite-profile.js";

describe("SQLite CycleStore descriptor", () => {
  it("matches the independent TypeScript/Python identity", () => {
    const descriptor = createSQLiteCycleStoreDescriptor();
    expect(validateCycleStoreProviderDescriptor(descriptor)).toEqual(descriptor);
    expect(descriptor.descriptorHash).toBe(SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
    expect(descriptor.providerId).toBe("sqlite-local");
  });

  it("states the bounded same-host capability profile", () => {
    const descriptor = createSQLiteCycleStoreDescriptor();
    expect(descriptor.capabilities).toMatchObject({
      durability: "durable",
      distributedFencing: false,
      legalHold: "enforced",
      backupRestore: "enforced",
    });
    expect(descriptor.protection).toMatchObject({
      payloadProtection: "external",
      encryptionAtRest: "external",
      rawPayloadObservability: false,
    });
    expect(descriptor.governance).toMatchObject({
      retention: "descriptor-only",
      archival: "descriptor-only",
      legalHoldBlocksDeletion: true,
    });
  });

  it("returns a detached descriptor for each caller", () => {
    const first = createSQLiteCycleStoreDescriptor();
    const second = createSQLiteCycleStoreDescriptor();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.capabilities).not.toBe(first.capabilities);
  });
});
