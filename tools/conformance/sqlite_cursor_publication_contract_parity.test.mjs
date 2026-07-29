import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalSerialize,
} from "../../packages/core/dist/index.js";
import {
  MAX_CYCLE_STORE_APPEND_BYTES,
  MAX_CYCLE_STORE_APPEND_RECORDS,
  MAX_CYCLE_STORE_CHECKPOINT_BYTES,
  MAX_CYCLE_STORE_LEASE_TTL_MS,
  MAX_CYCLE_STORE_PAGE_SIZE,
  MAX_CYCLE_STORE_RECORD_BYTES,
  cycleStoreAdapterCodec,
} from "../../packages/runtime/dist/index.js";
import {
  loadCursorPublicationFixture,
  validateCanonicalCursorPublicationFixture,
} from "../../spec/conformance/sqlite-cursor-publication-rebind-v2.validate.mjs";

const DOMAIN = Buffer.from(
  "graph-engineering/cycle-store-provider-descriptor/v1alpha1\0", "utf8",
);

function profile(version) {
  return {
    providerId: "sqlite-local",
    schemaVersion: version,
    compatibility: {
      minReaderVersion: version,
      maxReaderVersion: version,
      minWriterVersion: version,
      maxWriterVersion: version,
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

function derive(version) {
  const descriptor = cycleStoreAdapterCodec.createDescriptor(profile(version));
  const { descriptorHash, ...body } = descriptor;
  const bodyBytes = Buffer.from(canonicalSerialize(body), "utf8");
  const descriptorBytes = Buffer.from(canonicalSerialize(descriptor), "utf8");
  assert.equal(
    createHash("sha256").update(DOMAIN).update(bodyBytes).digest("hex"),
    descriptorHash,
  );
  return {
    schemaVersion: version,
    descriptorHash,
    descriptorBodyBytes: bodyBytes.length,
    descriptorBodySha256: createHash("sha256").update(bodyBytes).digest("hex"),
    descriptorCanonicalBytes: descriptorBytes.length,
    descriptorCanonicalSha256: createHash("sha256").update(descriptorBytes).digest("hex"),
    domainBytes: DOMAIN.length,
    domainSeparatedBytes: DOMAIN.length + bodyBytes.length,
  };
}

function pythonReport() {
  const child = spawnSync(
    "uv",
    ["run", "--project", "python", "python",
      "tools/conformance/sqlite_cursor_publication_contract_python_report.py"],
    { encoding: "utf8", maxBuffer: 2 << 20, timeout: 30_000 },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  return JSON.parse(child.stdout);
}

test("TypeScript and Python independently freeze the same B3 source and target descriptors", () => {
  const contract = validateCanonicalCursorPublicationFixture();
  const fixture = loadCursorPublicationFixture();
  const typescript = { source: derive(1), target: derive(2) };
  const python = pythonReport();
  assert.deepEqual(python.source, typescript.source);
  assert.deepEqual(python.target, typescript.target);
  assert.equal(typescript.source.descriptorHash, fixture.identities.source.descriptorHash);
  assert.equal(typescript.target.descriptorHash, contract.targetDescriptorHash);
  assert.equal(typescript.target.descriptorBodySha256,
    fixture.identities.target.descriptorBodySha256);
  assert.equal(typescript.target.descriptorCanonicalSha256,
    fixture.identities.target.descriptorCanonicalSha256);
  assert.equal(python.implementationClaim, false);
  assert.equal(python.activeManifestClaim, false);
});
