import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BASELINE_EMPTY_ROOT,
  BASELINE_ENTRY_DOMAIN,
  BASELINE_ENTRY_KINDS,
  BASELINE_GENESIS_HASH,
  BASELINE_ID_DOMAIN,
  BASELINE_PROJECTION_DOMAIN,
  OPERATION_BASELINE_POLICY,
  OperationBaselineError,
  buildOperationBaseline,
  createOperationBaselineId,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselinePolicy,
  encodeOperationBaselineSourceEnvelope,
  encodeOperationBaselineState,
} from "../src/operation-baseline.js";

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const source = {
  capturedAtMs: 27,
  sourceApplicationId: 1195724359,
  sourceDescriptorHash: H,
  sourceMigrationLineageId: "fresh-v1-baseline",
  sourceMigrationLineageSha256: H2,
  sourceSchemaIdentitySha256: H,
  sourceUserVersion: 1,
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe("SQLite operation baseline byte protocol", () => {
  it("freezes domains, roots, policy bytes, and source-derived ID", () => {
    expect(BASELINE_ENTRY_KINDS).toHaveLength(12);
    expect(BASELINE_GENESIS_HASH).toBe(sha256("graph-engineering/sqlite-operation-baseline-genesis/v1\0"));
    expect(BASELINE_EMPTY_ROOT).toBe(sha256("graph-engineering/sqlite-operation-baseline-empty/v1\0"));
    expect(encodeOperationBaselinePolicy().toString("utf8")).toBe(JSON.stringify(OPERATION_BASELINE_POLICY));
    const bytes = encodeOperationBaselineSourceEnvelope(source);
    expect(bytes.toString("utf8")).toBe(JSON.stringify(source));
    expect(createOperationBaselineId(source)).toBe(`v2-${sha256(`${BASELINE_ID_DOMAIN}${bytes.toString("utf8")}`)}`);
  });

  it("encodes closed key/state objects and rejects unknown or invalid fields", () => {
    expect(encodeOperationBaselineKey("stream-head", { tenantId: "t", streamId: "s" }).toString()).toBe('{"streamId":"s","tenantId":"t"}');
    const state = { createdAtMs: 1, streamId: "s", tailRecordHash: null, tailSequence: -1, tenantId: "t", updatedAtMs: 2 };
    expect(encodeOperationBaselineState("stream-head", state).toString()).toContain('"tailSequence":-1');
    expect(() => encodeOperationBaselineKey("stream-head", { tenantId: "t", streamId: "s", extra: true })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("stream-head", { ...state, tailRecordHash: "no" })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineSourceEnvelope({ ...source, sourceUserVersion: 2 })).toThrow(OperationBaselineError);
  });

  it("executes the closed key and state contract for all twelve entry kinds", () => {
    const summary = { checkpointScope: "scope", checkpointId: "cp", streamId: "s", boundSequence: 0, boundRecordHash: H, createdAt: "2026-07-27T00:00:00Z", valueHash: H2, valueBytes: 1 };
    const samples = [
      ["schema-envelope", { scope: "cycle-store" }, { createdAtMs: 1, currentVersion: 1, latestMigrationAppliedAtMs: 1, latestMigrationSha256: H, maxReaderVersion: 1, maxWriterVersion: 1, minReaderVersion: 1, minWriterVersion: 1, providerDescriptorHash: H2, schemaIdentitySha256: H, updatedAtMs: 2 }],
      ["migration-lineage", { version: 1 }, { appliedAtMs: 1, migrationId: "fresh-v1-baseline", postconditions: { requiredPostconditions: ["catalog-matches-manifest"] }, previousVersion: 0, reversibility: "rebuild-from-verified-backup-only", schemaIdentitySha256: H, sqlSha256: H2, version: 1 }],
      ["stream-head", { streamId: "s", tenantId: "t" }, { createdAtMs: 1, streamId: "s", tailRecordHash: null, tailSequence: -1, tenantId: "t", updatedAtMs: 2 }],
      ["record-identity", { recordId: "r", tenantId: "t" }, { committedAtMs: 1, previousRecordHash: null, recordHash: H, recordId: "r", sequence: 0, streamId: "s", tenantId: "t", valueBytes: 1, valueHash: H2 }],
      ["checkpoint-current", { checkpointId: "cp", checkpointScope: "scope", tenantId: "t" }, { boundRecordHash: H, boundSequence: 0, checkpointId: "cp", checkpointRevision: 1, checkpointScope: "scope", committedAtMs: 1, createdAt: "2026-07-27T00:00:00Z", streamId: "s", summary, tenantId: "t", valueBytes: 1, valueHash: H2 }],
      ["checkpoint-revision", { checkpointScope: "scope", revision: 1, tenantId: "t" }, { action: "put", boundRecordHash: H, boundSequence: 0, checkpointCreatedAt: "2026-07-27T00:00:00Z", checkpointId: "cp", checkpointScope: "scope", recordedAtMs: 1, revision: 1, summary, tenantId: "t", valueBytes: 1, valueHash: H2 }],
      ["lease-current", { streamId: "s", tenantId: "t" }, { activeAcquiredAtMs: null, activeExpiresAtMs: null, activeFencingToken: null, activeHolderId: null, activeLeaseEpoch: null, activeLeaseId: null, lastFencingToken: 0, lastLeaseEpoch: 0, streamId: "s", tenantId: "t", updatedAtMs: 1 }],
      ["used-lease-identity", { leaseId: "lease", streamId: "s", tenantId: "t" }, { fencingToken: 1, firstUsedAtMs: 1, leaseEpoch: 1, leaseId: "lease", streamId: "s", tenantId: "t" }],
      ["legal-hold", { holdId: "hold", streamId: "s", tenantId: "t" }, { holdId: "hold", placedAtMs: 1, streamId: "s", tenantId: "t" }],
      ["migration-lock-current", { singleton: 1 }, { activeAcquiredAtMs: null, activeExpiresAtMs: null, activeFencingToken: null, activeLockEpoch: null, activeLockId: null, activeOwnerId: null, activeSourceVersion: null, activeTargetVersion: null, lastFencingToken: 0, lastLockEpoch: 0, singleton: 1, updatedAtMs: 1 }],
      ["used-migration-lock-identity", { lockId: "lock" }, { fencingToken: 1, firstUsedAtMs: 1, lockEpoch: 1, lockId: "lock" }],
      ["legacy-operation", { operationId: "op", tenantId: "t" }, { committedAtMs: 1, operationId: "op", operationName: "append", requestHash: H, resultBlobSha256: H2, resultHash: H, tenantId: "t" }],
    ] as const;
    expect(samples.map(([kind, key, state]) => [
      encodeOperationBaselineKey(kind, key).byteLength,
      encodeOperationBaselineState(kind, state).byteLength,
    ])).toHaveLength(12);
  });

  it("sorts by kind rank then unsigned key bytes and creates a deterministic chain", () => {
    const state = (streamId: string) => ({ createdAtMs: 1, streamId, tailRecordHash: null, tailSequence: -1, tenantId: "t", updatedAtMs: 2 });
    const baselineId = createOperationBaselineId(source);
    const result = buildOperationBaseline(baselineId, [
      { entryKind: "stream-head", key: { tenantId: "t", streamId: "z" }, state: state("z") },
      { entryKind: "stream-head", key: { tenantId: "t", streamId: "a" }, state: state("a") },
      { entryKind: "schema-envelope", key: { scope: "cycle-store" }, state: { createdAtMs: 1, currentVersion: 1, latestMigrationAppliedAtMs: 1, latestMigrationSha256: H, maxReaderVersion: 1, maxWriterVersion: 1, minReaderVersion: 1, minWriterVersion: 1, providerDescriptorHash: H2, schemaIdentitySha256: H, updatedAtMs: 2 } },
    ]);
    expect(result.entries.map((entry) => [entry.entryKind, entry.keyBytes.toString()])).toEqual([
      ["schema-envelope", '{"scope":"cycle-store"}'],
      ["stream-head", '{"streamId":"a","tenantId":"t"}'],
      ["stream-head", '{"streamId":"z","tenantId":"t"}'],
    ]);
    expect(result.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
    expect(result.entries[0]?.previousEntryHash).toBe(BASELINE_GENESIS_HASH);
    expect(result.entries[1]?.previousEntryHash).toBe(result.entries[0]?.entryHash);
    expect(result.projectionSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(BASELINE_ENTRY_DOMAIN).toContain("\0"); expect(BASELINE_PROJECTION_DOMAIN).toContain("\0");
  });

  it("uses the empty root, counts legacy operations, and rejects duplicate keys", () => {
    const baselineId = createOperationBaselineId(source);
    const empty = buildOperationBaseline(baselineId, []);
    expect(empty).toMatchObject({ entryCount: 0, firstEntryHash: BASELINE_EMPTY_ROOT, finalEntryHash: BASELINE_EMPTY_ROOT, legacyOperationCount: 0 });
    const legacy = { committedAtMs: 1, operationId: "op", operationName: "append", requestHash: H, resultBlobSha256: H2, resultHash: H, tenantId: "t" };
    expect(buildOperationBaseline(baselineId, [{ entryKind: "legacy-operation", key: { operationId: "op", tenantId: "t" }, state: legacy }]).legacyOperationCount).toBe(1);
    expect(() => buildOperationBaseline(baselineId, [
      { entryKind: "legacy-operation", key: { operationId: "op", tenantId: "t" }, state: legacy },
      { entryKind: "legacy-operation", key: { tenantId: "t", operationId: "op" }, state: legacy },
    ])).toThrow(OperationBaselineError);
  });

  it("does not expose mutable buffers from a completed projection", () => {
    const baselineId = createOperationBaselineId(source);
    const state = { createdAtMs: 1, streamId: "s", tailRecordHash: null, tailSequence: -1, tenantId: "t", updatedAtMs: 2 };
    const projection = buildOperationBaseline(baselineId, [
      { entryKind: "stream-head", key: { streamId: "s", tenantId: "t" }, state },
    ]);
    const entry = projection.entries[0]!;
    const keyHex = entry.keyBytes.toString("hex");
    const stateHex = entry.stateBytes.toString("hex");
    entry.keyBytes.fill(0);
    entry.stateBytes.fill(0);
    expect(entry.keyBytes.toString("hex")).toBe(keyHex);
    expect(entry.stateBytes.toString("hex")).toBe(stateHex);
    expect(projection.finalEntryHash).toBe(entry.entryHash);
  });

  it("rejects relationally inconsistent state before hashing", () => {
    const baselineId = createOperationBaselineId(source);
    const stream = { createdAtMs: 1, streamId: "s", tailRecordHash: null, tailSequence: 0, tenantId: "t", updatedAtMs: 2 };
    expect(() => encodeOperationBaselineState("stream-head", stream)).toThrow(OperationBaselineError);
    const lease = { activeAcquiredAtMs: 1, activeExpiresAtMs: null, activeFencingToken: 1, activeHolderId: "owner", activeLeaseEpoch: 1, activeLeaseId: "lease", lastFencingToken: 1, lastLeaseEpoch: 1, streamId: "s", tenantId: "t", updatedAtMs: 1 };
    expect(() => encodeOperationBaselineState("lease-current", lease)).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("used-lease-identity", { fencingToken: 2, firstUsedAtMs: 1, leaseEpoch: 1, leaseId: "lease", streamId: "s", tenantId: "t" })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("legacy-operation", { committedAtMs: 1, operationId: "op", operationName: "read-tail", requestHash: H, resultBlobSha256: H2, resultHash: H, tenantId: "t" })).toThrow(OperationBaselineError);
    const goodStream = { ...stream, tailSequence: -1 };
    expect(() => buildOperationBaseline(baselineId, [{ entryKind: "stream-head", key: { streamId: "other", tenantId: "t" }, state: goodStream }])).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("migration-lineage", { appliedAtMs: 1, migrationId: "m", postconditions: {}, previousVersion: 0, reversibility: "forward-only", schemaIdentitySha256: H, sqlSha256: H2, version: 1 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("schema-envelope", { createdAtMs: 2, currentVersion: 1, latestMigrationAppliedAtMs: 1, latestMigrationSha256: H, maxReaderVersion: 1, maxWriterVersion: 1, minReaderVersion: 1, minWriterVersion: 1, providerDescriptorHash: H2, schemaIdentitySha256: H, updatedAtMs: 1 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("migration-lineage", { appliedAtMs: 1, migrationId: "m", postconditions: { requiredPostconditions: [] }, previousVersion: 0, reversibility: "rebuild-from-verified-backup-only", schemaIdentitySha256: H, sqlSha256: H2, version: 1 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("record-identity", { committedAtMs: 1, previousRecordHash: H2, recordHash: H, recordId: "r", sequence: 0, streamId: "s", tenantId: "t", valueBytes: 1, valueHash: H2 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("migration-lock-current", { activeAcquiredAtMs: 1, activeExpiresAtMs: 3, activeFencingToken: 1, activeLockEpoch: 1, activeLockId: "lock", activeOwnerId: "owner", activeSourceVersion: 2, activeTargetVersion: 2, lastFencingToken: 1, lastLockEpoch: 1, singleton: 1, updatedAtMs: 1 })).toThrow(OperationBaselineError);
    const summary = { checkpointScope: "scope", checkpointId: "cp", streamId: "s", boundSequence: 0, boundRecordHash: H, createdAt: "2026-02-30T00:00:00Z", valueHash: H2, valueBytes: 1 };
    expect(() => encodeOperationBaselineState("checkpoint-current", { boundRecordHash: H, boundSequence: 0, checkpointId: "cp", checkpointRevision: 1, checkpointScope: "scope", committedAtMs: 1, createdAt: "2026-02-30T00:00:00Z", streamId: "s", summary, tenantId: "t", valueBytes: 1, valueHash: H2 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("checkpoint-revision", { action: "put", boundRecordHash: H, boundSequence: 0, checkpointCreatedAt: "2026-02-30T00:00:00Z", checkpointId: "cp", checkpointScope: "scope", recordedAtMs: 1, revision: 1, summary, tenantId: "t", valueBytes: 1, valueHash: H2 })).toThrow(OperationBaselineError);
    const mismatchedSummary = { ...summary, checkpointId: "different", createdAt: "2026-07-27T00:00:00Z" };
    expect(() => encodeOperationBaselineState("checkpoint-current", { boundRecordHash: H, boundSequence: 0, checkpointId: "cp", checkpointRevision: 1, checkpointScope: "scope", committedAtMs: 1, createdAt: "2026-07-27T00:00:00Z", streamId: "s", summary: mismatchedSummary, tenantId: "t", valueBytes: 1, valueHash: H2 })).toThrow(OperationBaselineError);
    expect(() => encodeOperationBaselineState("checkpoint-revision", { action: "put", boundRecordHash: H, boundSequence: 0, checkpointCreatedAt: "2026-07-27T00:00:00Z", checkpointId: "cp", checkpointScope: "scope", recordedAtMs: 1, revision: 1, summary: mismatchedSummary, tenantId: "t", valueBytes: 1, valueHash: H2 })).toThrow(OperationBaselineError);
  });

  it("rejects non-canonical, duplicate-key, invalid UTF-8, and oversized stored bytes", () => {
    expect(decodeOperationBaselineCanonicalBytes(Buffer.from('{"a":1}'), 20)).toEqual({ a: 1 });
    for (const bytes of [Buffer.from('{ "a":1}'), Buffer.from('{"a":1,"a":1}'), Buffer.from([0xc3, 0x28]), Buffer.alloc(21, 0x61)]) {
      expect(() => decodeOperationBaselineCanonicalBytes(bytes, 20)).toThrow(OperationBaselineError);
    }
  });

  it("matches the shared twelve-kind golden fixture byte-for-byte", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../spec/conformance/sqlite-operation-baseline-v2.case.json", import.meta.url),
      "utf8",
    )) as {
      readonly sourceEnvelope: unknown;
      readonly baselineId: string;
      readonly policyVector: { readonly canonicalHex: string };
      readonly entryVectors: readonly {
        readonly entryKind: (typeof BASELINE_ENTRY_KINDS)[number];
        readonly key: { readonly value: unknown; readonly canonicalHex: string };
        readonly state: { readonly value: unknown; readonly canonicalHex: string };
        readonly entryHash: string;
      }[];
      readonly projection: {
        readonly canonicalValue: {
          readonly entryCount: number;
          readonly firstEntryHash: string;
          readonly finalEntryHash: string;
          readonly legacyOperationCount: number;
        };
        readonly sha256: string;
      };
    };
    expect(createOperationBaselineId(fixture.sourceEnvelope)).toBe(fixture.baselineId);
    expect(encodeOperationBaselinePolicy().toString("hex")).toBe(
      fixture.policyVector.canonicalHex,
    );
    const projection = buildOperationBaseline(
      fixture.baselineId,
      fixture.entryVectors.map((vector) => ({
        entryKind: vector.entryKind,
        key: vector.key.value,
        state: vector.state.value,
      })),
    );
    expect(projection.entries.map((entry) => entry.keyBytes.toString("hex"))).toEqual(
      fixture.entryVectors.map((vector) => vector.key.canonicalHex),
    );
    expect(projection.entries.map((entry) => entry.stateBytes.toString("hex"))).toEqual(
      fixture.entryVectors.map((vector) => vector.state.canonicalHex),
    );
    expect(projection.entries.map((entry) => entry.entryHash)).toEqual(
      fixture.entryVectors.map((vector) => vector.entryHash),
    );
    expect(projection).toMatchObject({
      entryCount: fixture.projection.canonicalValue.entryCount,
      firstEntryHash: fixture.projection.canonicalValue.firstEntryHash,
      finalEntryHash: fixture.projection.canonicalValue.finalEntryHash,
      legacyOperationCount: fixture.projection.canonicalValue.legacyOperationCount,
      projectionSha256: fixture.projection.sha256,
    });
  });
});
