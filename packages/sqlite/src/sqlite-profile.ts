import {
  MAX_CYCLE_STORE_APPEND_BYTES,
  MAX_CYCLE_STORE_APPEND_RECORDS,
  MAX_CYCLE_STORE_CHECKPOINT_BYTES,
  MAX_CYCLE_STORE_LEASE_TTL_MS,
  MAX_CYCLE_STORE_PAGE_SIZE,
  MAX_CYCLE_STORE_RECORD_BYTES,
  cycleStoreAdapterCodec,
  type CycleStoreProviderDescriptor,
  type CycleStoreProviderProfile,
} from "@graph-engineering/runtime";

import { SQLITE_CYCLE_STORE_PROVIDER_ID } from "./constants.js";

export const SQLITE_CYCLE_STORE_DESCRIPTOR_HASH =
  "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe" as const;

function profile(): CycleStoreProviderProfile {
  return {
    providerId: SQLITE_CYCLE_STORE_PROVIDER_ID,
    schemaVersion: 1,
    compatibility: {
      minReaderVersion: 1,
      maxReaderVersion: 1,
      minWriterVersion: 1,
      maxWriterVersion: 1,
    },
    limits: {
      maxAppendRecords: MAX_CYCLE_STORE_APPEND_RECORDS,
      maxRecordBytes: MAX_CYCLE_STORE_RECORD_BYTES,
      maxAppendBytes: MAX_CYCLE_STORE_APPEND_BYTES,
      maxPageSize: MAX_CYCLE_STORE_PAGE_SIZE,
      maxCheckpointBytes: MAX_CYCLE_STORE_CHECKPOINT_BYTES,
      maxLeaseTtlMs: MAX_CYCLE_STORE_LEASE_TTL_MS,
    },
    capabilities: {
      durability: "durable",
      distributedFencing: false,
      snapshotPagination: true,
      checkpointCrud: true,
      legalHold: "enforced",
      backupRestore: "enforced",
      compaction: "logical-history-preserving",
    },
    protection: {
      payloadProtection: "external",
      encryptionAtRest: "external",
      rawPayloadObservability: false,
    },
    governance: {
      retention: "descriptor-only",
      archival: "descriptor-only",
      legalHoldBlocksDeletion: true,
      migrationLock: "exclusive-fenced",
      backupIdentity: "content-addressed",
    },
  };
}

/** Produces a fresh, validated descriptor shared byte-for-byte with Python. */
export function createSQLiteCycleStoreDescriptor(): CycleStoreProviderDescriptor {
  const descriptor = cycleStoreAdapterCodec.createDescriptor(profile());
  if (descriptor.descriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH) {
    throw new Error("SQLite CycleStore descriptor identity drifted");
  }
  return descriptor;
}
