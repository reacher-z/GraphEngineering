import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "@graph-engineering/core";

import * as sqlitePackage from "../src/index.js";
import {
  BASELINE_ENTRY_KINDS,
  BASELINE_PROJECTION_DOMAIN,
  OperationBaselineAccumulator,
  createOperationBaselineId,
  operationBaselineDomainHash,
  type OperationBaselineProjectionIdentity,
  type OperationBaselineSourceEnvelope,
} from "../src/operation-baseline.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { captureSQLiteV1BaselineSourceSummary } from "../src/operation-baseline-source.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import {
  decodeSQLiteCursorSealRow,
  sealSQLiteCursorRows,
  type SQLiteCursorSealReceipt,
  type SQLiteCursorSealRow,
} from "../src/operation-baseline-cursor-invariants.js";
import {
  SQLITE_CURSOR_BASELINE_PROJECTION_FIELDS,
  SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS,
  SQLITE_CURSOR_MAIN_SOURCE_QUERY,
  SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS,
  SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN,
  SQLITE_CURSOR_SESSION_FIELDS,
  SQLITE_CURSOR_STATIC_PROJECTION_FIELDS,
  SQLITE_CURSOR_STATIC_PROJECTION_SHA256,
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  type SQLiteCursorPreRebindIssueInput,
} from "../src/operation-baseline-cursor-ownership.js";
import type {
  SQLiteV1BaselineClockEvidence,
  SQLiteV1BaselineCounts,
  SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";

const D = "e".repeat(64); const S = "f".repeat(64);
const ROOT = "587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f";

function testFramed(domain: string, value: unknown): string {
  const bytes = Buffer.from(canonicalSerialize(value), "utf8");
  const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(bytes.length));
  return createHash("sha256").update(domain).update(length).update(bytes).digest("hex");
}

const CURSOR_A = "a".repeat(64); const CURSOR_B = "b".repeat(64);
const CURSOR_C = "c".repeat(64); const CURSOR_D = "d".repeat(64);
const CURSOR_EVENT_SCOPE = Buffer.from(
  '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"stream-alpha"}',
  "utf8",
);
const CURSOR_CHECKPOINT_SCOPE = Buffer.from(
  '{"checkpointScope":"checkpoint-scope","contractVersion":"cycle-store-provider/v1alpha1","pageSize":16}',
  "utf8",
);
function sharedCursorRow(
  kind: "event" | "checkpoint", descriptor: string, schema: string,
): SQLiteCursorSealRow {
  return decodeSQLiteCursorSealRow(kind === "event" ? [
    "tenant-alpha", CURSOR_A, "event", CURSOR_B, CURSOR_C, "stream-alpha", null,
    CURSOR_EVENT_SCOPE, 64n, 7n, 6n, CURSOR_D, descriptor, schema,
    Buffer.from(`{"recordHash":"${CURSOR_D}","sequence":6}`, "utf8"),
    1_700_000_000_000n, 1_700_000_300_000n, null,
  ] : [
    "tenant-beta", CURSOR_B, "checkpoint", CURSOR_C, CURSOR_D, null, "checkpoint-scope",
    CURSOR_CHECKPOINT_SCOPE, 16n, 2n, null, null, descriptor, schema,
    Buffer.from('[{"checkpointId":"cp-b","checkpointScope":"checkpoint-scope","revision":2},'
      + '{"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","revision":1}]', "utf8"),
    1_700_000_000_000n, 1_700_000_300_000n, 1_700_000_100_000n,
  ]);
}
function* sharedFleetRows(descriptor: string, schema: string): Generator<SQLiteCursorSealRow> {
  for (let index = 0; index < 1_024; index += 1) {
    yield decodeSQLiteCursorSealRow([
      "tenant-fleet", index.toString(16).padStart(64, "0"), "event", CURSOR_B, CURSOR_C,
      "stream-fleet", null,
      Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":32,'
        + '"streamId":"stream-fleet"}', "utf8"),
      32n, BigInt(index), BigInt(index), CURSOR_D, descriptor, schema,
      Buffer.from(`{"recordHash":"${CURSOR_D}","sequence":${index}}`, "utf8"),
      BigInt(1_700_000_000_000 + index), BigInt(1_700_000_300_000 + index), null,
    ]);
  }
}

function fixture(): SQLiteCursorPreRebindIssueInput {
  const capturedAtMs = 1_700_000_000_000;
  const sourceEnvelope: OperationBaselineSourceEnvelope = Object.freeze({
    capturedAtMs, sourceApplicationId: 1195724359, sourceDescriptorHash: D,
    sourceMigrationLineageId: "fresh-v1-baseline", sourceMigrationLineageSha256: "a".repeat(64),
    sourceSchemaIdentitySha256: S, sourceUserVersion: 1,
  });
  const clockEvidence: SQLiteV1BaselineClockEvidence = Object.freeze({
    capturedAtMs, maximumNonCursorObservedAtMs: capturedAtMs,
    providerHighWaterAtMs: capturedAtMs,
  });
  const countsByKind = Object.freeze(Object.fromEntries(
    BASELINE_ENTRY_KINDS.map((kind) => [kind, kind === "schema-envelope"
      || kind === "migration-lineage" || kind === "migration-lock-current" ? 1 : 0]),
  )) as SQLiteV1BaselineCounts;
  const sourceSummary = Object.freeze({
    sourceEnvelope, clockEvidence, countsByKind, expectedEntryCount: 3,
    entries: () => (function* () { /* no database in this fixture */ })(),
  }) as SQLiteV1BaselineSourceSummary;
  const base = {
    baselineId: createOperationBaselineId(sourceEnvelope), entryCount: 3,
    finalEntryHash: "c".repeat(64), firstEntryHash: "b".repeat(64), legacyOperationCount: 0,
  };
  const projectionIdentity: OperationBaselineProjectionIdentity = Object.freeze({
    ...base, projectionSha256: operationBaselineDomainHash(BASELINE_PROJECTION_DOMAIN, base),
  });
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt: SQLiteCursorSealReceipt = Object.freeze({
    cursorCount: 0, immutableRootSha256: ROOT,
    sourceDescriptorHash: D, sourceSchemaIdentitySha256: S,
  });
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 0));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability("source-stage", Buffer.alloc(32, 0x11));
  const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, 0x22));
  const connectionOwnership = createSQLiteCursorOwnershipCapability("connection", Buffer.alloc(32, 0x33));
  const session = createSQLiteCursorCaptureSession({
    tenantOwnership, sourceStageOwnership, campaignOwnership, connectionOwnership,
    nonce: Buffer.alloc(32, 0x44),
  });
  return Object.freeze({
    campaignOwnership, clockEvidence, connectionOwnership,
    projectionIdentity, projectionReference, sealReceipt, session, sourceStageOwnership,
    sourceSummary, tenantOwnership,
  });
}

describe("SQLite cursor A2b ownership receipt", () => {
  it("freezes corrected main projection and all protocol field arrays", () => {
    expect(SQLITE_CURSOR_MAIN_SOURCE_QUERY).toContain("FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY");
    expect(SQLITE_CURSOR_MAIN_SOURCE_QUERY).not.toContain(";");
    expect(createHash("sha256").update(SQLITE_CURSOR_MAIN_SOURCE_QUERY).digest("hex"))
      .toBe("dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4");
    expect(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS).toHaveLength(16);
    expect(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS).not.toContain("descriptor_hash");
    expect(SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS).not.toContain("schema_identity_sha256");
    for (const fields of [SQLITE_CURSOR_STATIC_PROJECTION_FIELDS,
      SQLITE_CURSOR_BASELINE_PROJECTION_FIELDS, SQLITE_CURSOR_SESSION_FIELDS,
      SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS]) expect(Object.isFrozen(fields)).toBe(true);
    expect(SQLITE_CURSOR_STATIC_PROJECTION_SHA256).toBe(
      "82bbb4c486590745fb6363151418bb8f50a1c56c4438c8b535b60f01fca7f8b9",
    );
  });

  it("mints once and exposes a non-consuming original-object provenance fence", () => {
    const input = fixture(); const issuer = new SQLiteCursorPreRebindReceiptIssuer(input);
    const receipt = issuer.issue(input); const first = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    expect(first).toEqual(assertSQLiteCursorPreRebindReceiptProvenance(receipt));
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(first)).toBe(true);
    expect(() => issuer.issue(input)).toThrow(/issuer reuse/u);
    expect(() => assertSQLiteCursorPreRebindReceiptProvenance(
      { ...receipt } as typeof receipt,
    )).toThrow(/provenance/u);
  });

  it("binds the shared empty, one, multi and hostile real-source vectors", () => {
    const vectors = [
      { capturedAtMs: 1_785_110_405_000, count: 0, fills: [0x00, 0x11, 0x22, 0x33, 0x44],
        sealRoot: ROOT,
        projectionRoot: "2f512edf3ef9899fc109d415a2d392604f083257445ca43c2fab1aa29e06f615",
        receiptRoot: "e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad" },
      { capturedAtMs: 1_785_110_405_100, count: 1, fills: [0x01, 0x12, 0x23, 0x34, 0x45],
        sealRoot: "1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea",
        projectionRoot: "1b1216f52ee1065506d4bc95d8f60e7bb7ed770650d5642bcb5f3af489035f41",
        receiptRoot: "cb710d7ec15c2e5c729ee813d5f0b03dcfdf795203df8a4ecf5a174b063743f6" },
      { capturedAtMs: 1_785_110_405_200, count: 2, fills: [0x02, 0x13, 0x24, 0x35, 0x46],
        sealRoot: "3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1",
        projectionRoot: "f251a94daf436f8e0f6ab26b15e2c308756697990dd1c08be9e8591dc8fb9073",
        receiptRoot: "f0571ef81f6864bccc2bedbe81f586363bb3d8ca2ff38b3545f95bfbe808b6c7" },
      { capturedAtMs: Number.MAX_SAFE_INTEGER, count: 1_024,
        fills: [0xff, 0xee, 0xdd, 0xcc, 0xbb],
        sealRoot: "2d9327dc17dadaf43c3643b853d38ea09e0e396d7005e553a5a5e88469b3857f",
        projectionRoot: "a7e33b7658cdb0040d842c5652db713bfdb87ba4403a807b77cffb385066ca94",
        receiptRoot: "e319abeed2696190770ff3a54669afeb24eff4810dae6072cb3a8141766037fa" },
    ] as const;
    for (const vector of vectors) {
      const root = mkdtempSync(join(tmpdir(), "graph-engineering-a2b-"));
      const connection = new SQLiteConnection(join(root, "store.sqlite"));
      try {
      const { capturedAtMs } = vector;
      ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
        appliedAtMs: capturedAtMs,
      });
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, capturedAtMs);
      const accumulator = new OperationBaselineAccumulator(
        createOperationBaselineId(sourceSummary.sourceEnvelope), sourceSummary.expectedEntryCount,
      );
      for (const entry of sourceSummary.entries()) accumulator.append(entry);
      const projectionIdentity = accumulator.finish();
      const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
      const descriptor = sourceSummary.sourceEnvelope.sourceDescriptorHash;
      const schema = sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256;
      const rows: Iterable<SQLiteCursorSealRow> = vector.count === 0 ? []
        : vector.count === 1 ? [sharedCursorRow("event", descriptor, schema)]
          : vector.count === 2 ? [sharedCursorRow("event", descriptor, schema),
            sharedCursorRow("checkpoint", descriptor, schema)]
            : sharedFleetRows(descriptor, schema);
      const sealReceipt = sealSQLiteCursorRows(vector.count, descriptor, schema, rows);
      expect(sealReceipt.immutableRootSha256).toBe(vector.sealRoot);
      const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, vector.fills[0]));
      const sourceStageOwnership = createSQLiteCursorOwnershipCapability("source-stage", Buffer.alloc(32, vector.fills[1]));
      const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, vector.fills[2]));
      const connectionOwnership = createSQLiteCursorOwnershipCapability("connection", Buffer.alloc(32, vector.fills[3]));
      const session = createSQLiteCursorCaptureSession({
        tenantOwnership, sourceStageOwnership, campaignOwnership, connectionOwnership,
        nonce: Buffer.alloc(32, vector.fills[4]),
      });
      const input = Object.freeze({
        campaignOwnership, clockEvidence: sourceSummary.clockEvidence, connectionOwnership,
        projectionIdentity, projectionReference, sealReceipt, session, sourceStageOwnership,
        sourceSummary, tenantOwnership,
      });
      const receipt = new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
      const witness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
      expect(witness.sourceSummary).toBe(sourceSummary);
      expect(witness.projectionIdentity).toBe(projectionIdentity);
      expect(witness.projectionReferenceSha256).toBe(vector.projectionRoot);
      expect(sourceSummary.sourceEnvelope).toMatchObject({
        capturedAtMs,
        sourceApplicationId: 1_195_724_359,
        sourceDescriptorHash: "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
        sourceMigrationLineageId: "fresh-v1-baseline",
        sourceMigrationLineageSha256: "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
        sourceSchemaIdentitySha256: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
        sourceUserVersion: 1,
      });
      expect(sourceSummary.clockEvidence).toEqual({
        capturedAtMs,
        maximumNonCursorObservedAtMs: capturedAtMs,
        providerHighWaterAtMs: capturedAtMs,
      });
      expect(witness.receiptSha256).toBe(vector.receiptRoot);
      connection.execTrusted("ROLLBACK", "inspect-schema");
      } finally {
        connection.close(); rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("rejects every equal-value object substitution without consuming the issuer", () => {
    const input = fixture(); const issuer = new SQLiteCursorPreRebindReceiptIssuer(input);
    const replacements: readonly Partial<SQLiteCursorPreRebindIssueInput>[] = [
      { sourceSummary: { ...input.sourceSummary } as SQLiteV1BaselineSourceSummary },
      { clockEvidence: { ...input.clockEvidence } }, { sealReceipt: { ...input.sealReceipt } },
      { projectionIdentity: { ...input.projectionIdentity } },
      { projectionReference: { ...input.projectionReference } as typeof input.projectionReference },
      { session: { ...input.session } },
      { tenantOwnership: createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 0)) },
      { sourceStageOwnership: createSQLiteCursorOwnershipCapability("source-stage", Buffer.alloc(32, 0x11)) },
      { campaignOwnership: createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, 0x22)) },
      { connectionOwnership: createSQLiteCursorOwnershipCapability("connection", Buffer.alloc(32, 0x33)) },
    ];
    for (const replacement of replacements) {
      expect(() => issuer.issue({ ...input, ...replacement })).toThrow(/substitution/u);
    }
    expect(() => issuer.issue(input)).not.toThrow();
  });

  it("snapshots constructor refs and rejects open or accessor-bearing issue inputs", () => {
    const original = fixture();
    const mutable = { ...original };
    const issuer = new SQLiteCursorPreRebindReceiptIssuer(mutable);
    mutable.sourceSummary = { ...original.sourceSummary } as SQLiteV1BaselineSourceSummary;
    expect(() => issuer.issue(original)).not.toThrow();
    expect(() => new SQLiteCursorPreRebindReceiptIssuer(
      { ...original, extra: true } as SQLiteCursorPreRebindIssueInput,
    )).toThrow(/issue input/u);
    const accessor = { ...original } as Record<string, unknown>;
    Object.defineProperty(accessor, "session", { get: () => original.session, enumerable: true });
    expect(() => new SQLiteCursorPreRebindReceiptIssuer(
      accessor as unknown as SQLiteCursorPreRebindIssueInput,
    )).toThrow(/issue input/u);
    expect(() => new SQLiteCursorPreRebindReceiptIssuer(
      Object.assign(Object.create(null), original) as SQLiteCursorPreRebindIssueInput,
    )).toThrow(/issue input/u);
  });

  it("recomputes projection identity and cross-checks source, clocks and A1 identities", () => {
    const input = fixture();
    expect(() => createSQLiteCursorExactProjectionReference(Object.freeze({
      ...input.projectionIdentity, projectionSha256: "d".repeat(64),
    }))).toThrow(/projection hash/u);
    for (const changed of [
      { sourceSummary: Object.freeze({ ...input.sourceSummary, expectedEntryCount: 4 }) as SQLiteV1BaselineSourceSummary },
      { sealReceipt: Object.freeze({ ...input.sealReceipt, sourceDescriptorHash: "a".repeat(64) }) },
      { clockEvidence: Object.freeze({ ...input.clockEvidence, capturedAtMs: input.clockEvidence.capturedAtMs - 1 }) },
    ]) expect(() => new SQLiteCursorPreRebindReceiptIssuer({ ...input, ...changed })).toThrow();
  });

  it("enforces empty projection, count closure and safe integer boundaries", () => {
    const input = fixture();
    const projection = (entryCount: number, firstEntryHash: string, finalEntryHash: string) => {
      const base = { baselineId: input.projectionIdentity.baselineId, entryCount,
        finalEntryHash, firstEntryHash, legacyOperationCount: 0 };
      return Object.freeze({ ...base,
        projectionSha256: operationBaselineDomainHash(BASELINE_PROJECTION_DOMAIN, base) });
    };
    expect(() => createSQLiteCursorExactProjectionReference(
      projection(0, "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a",
        "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a"),
    )).not.toThrow();
    expect(() => createSQLiteCursorExactProjectionReference(
      projection(0, "b".repeat(64), "c".repeat(64)),
    )).toThrow(/empty root/u);
    expect(() => createSQLiteCursorExactProjectionReference(
      projection(1, "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a",
        "c".repeat(64)),
    )).toThrow(/empty root/u);

    const badCounts = Object.freeze({ ...input.sourceSummary.countsByKind,
      "stream-head": 1 });
    const badSummary = Object.freeze({ ...input.sourceSummary,
      countsByKind: badCounts }) as SQLiteV1BaselineSourceSummary;
    expect(() => new SQLiteCursorPreRebindReceiptIssuer({ ...input,
      sourceSummary: badSummary })).toThrow(/count total/u);
    for (const cursorCount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, true]) {
      expect(() => new SQLiteCursorPreRebindReceiptIssuer({ ...input,
        sealReceipt: Object.freeze({ ...input.sealReceipt, cursorCount }) as SQLiteCursorSealReceipt,
      })).toThrow();
    }
  });

  it("rejects every unsafe value in each of the three source clocks", () => {
    const input = fixture();
    for (const field of ["capturedAtMs", "maximumNonCursorObservedAtMs",
      "providerHighWaterAtMs"] as const) {
      for (const value of [-1, true, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const clockEvidence = Object.freeze({ ...input.clockEvidence,
          [field]: value }) as SQLiteV1BaselineClockEvidence;
        const sourceSummary = Object.freeze({ ...input.sourceSummary,
          clockEvidence }) as SQLiteV1BaselineSourceSummary;
        expect(() => new SQLiteCursorPreRebindReceiptIssuer({ ...input,
          clockEvidence, sourceSummary }), `${field}=${String(value)}`).toThrow(/invalid/u);
      }
    }
  });

  it("atomically rejects pairwise A/B provenance mixing between valid candidates", () => {
    const a = fixture(); const b = fixture();
    expect(() => new SQLiteCursorPreRebindReceiptIssuer(b).issue(b)).not.toThrow();
    const issuer = new SQLiteCursorPreRebindReceiptIssuer(a);
    const mixes: readonly Partial<SQLiteCursorPreRebindIssueInput>[] = [
      { sourceSummary: b.sourceSummary, clockEvidence: b.clockEvidence },
      { clockEvidence: b.clockEvidence },
      { sourceStageOwnership: b.sourceStageOwnership },
      { campaignOwnership: b.campaignOwnership },
      { projectionIdentity: b.projectionIdentity, projectionReference: b.projectionReference },
      { session: b.session },
    ];
    for (const mix of mixes) expect(() => issuer.issue({ ...a, ...mix })).toThrow(/substitution/u);
    expect(() => issuer.issue(a)).not.toThrow();
  });

  it("uses all thirteen receipt contributions with order-independent canonical framing", () => {
    const document: Record<string, string | number> = {
      campaignOwnershipSha256: "ea0dd6375ed7724dfc8e4a0a0f158c1817c525f499f67009269bdfb22c9e4593",
      captureSessionSha256: "7d10c5f91bd4c2ab8c53698c22650969860da8cf1bb0a703d70573e433fbb996",
      capturedAtMs: 1_785_110_405_000,
      connectionOwnershipSha256: "a637faff54da41c85411b5d8e9d5cc011d2ad7d111bc5d3edc93e7a9757deae9",
      cursorCount: 0, immutableRootSha256: ROOT,
      maximumNonCursorObservedAtMs: 1_785_110_405_000,
      projectionReferenceSha256: "2f512edf3ef9899fc109d415a2d392604f083257445ca43c2fab1aa29e06f615",
      providerHighWaterAtMs: 1_785_110_405_000,
      sourceDescriptorHash: "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
      sourceSchemaIdentitySha256: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
      sourceStageOwnershipSha256: "ab73339b1dddba0d2f59fc0e4c06e52ede49605e7371570eb65af0e534d2b4d6",
      tenantOwnershipSha256: "beb52ca0b8f78bc0659222c20965c3e3cd0bc783e13cec72595e116d301783e0",
    };
    const root = testFramed(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, document);
    expect(root).toBe("e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad");
    expect(Object.keys(document).sort()).toEqual([...SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS].sort());
    expect(testFramed(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN,
      Object.fromEntries(Object.entries(document).reverse()))).toBe(root);
    for (const field of SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS) {
      const current = document[field];
      const changed = { ...document, [field]: typeof current === "number"
        ? current + 1 : current === ROOT ? "1".repeat(64) : "0".repeat(64) };
      expect(testFramed(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, changed), field).not.toBe(root);
    }
  });

  it("rejects hidden shape extensions and invalid nonce without invoking caller getters", () => {
    const input = fixture();
    const hidden = { ...input };
    Object.defineProperty(hidden, "hidden", { value: true });
    expect(() => new SQLiteCursorPreRebindReceiptIssuer(hidden as SQLiteCursorPreRebindIssueInput))
      .toThrow(/issue input/u);
    for (const nonce of [Buffer.alloc(31), Buffer.alloc(33), "x", null]) {
      expect(() => createSQLiteCursorCaptureSession({
        campaignOwnership: input.campaignOwnership,
        connectionOwnership: input.connectionOwnership,
        nonce: nonce as unknown as Uint8Array,
        sourceStageOwnership: input.sourceStageOwnership,
        tenantOwnership: input.tenantOwnership,
      })).toThrow(/nonce bytes/u);
    }
    const proxy = new Proxy({ ...input }, { get: () => { throw new Error("getter invoked"); } });
    const issuer = new SQLiteCursorPreRebindReceiptIssuer(proxy);
    expect(() => issuer.issue(input)).not.toThrow();
  });

  it("retains only immutable capability/session provenance after issuance", () => {
    const input = fixture(); const issuer = new SQLiteCursorPreRebindReceiptIssuer(input);
    const receipt = issuer.issue(input);
    const root = assertSQLiteCursorPreRebindReceiptProvenance(receipt).receiptSha256;
    expect(assertSQLiteCursorPreRebindReceiptProvenance(receipt).receiptSha256).toBe(root);
  });

  it("defensively copies all four ownership refs and the nonce", () => {
    const base = fixture();
    const raw = [Buffer.alloc(32), Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22),
      Buffer.alloc(32, 0x33), Buffer.alloc(32, 0x44)] as const;
    const make = (values: readonly Buffer[]) => {
      const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", values[0]!);
      const sourceStageOwnership = createSQLiteCursorOwnershipCapability("source-stage", values[1]!);
      const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", values[2]!);
      const connectionOwnership = createSQLiteCursorOwnershipCapability("connection", values[3]!);
      const session = createSQLiteCursorCaptureSession({ tenantOwnership, sourceStageOwnership,
        campaignOwnership, connectionOwnership, nonce: values[4]! });
      return Object.freeze({ ...base, tenantOwnership, sourceStageOwnership,
        campaignOwnership, connectionOwnership, session });
    };
    const first = make(raw);
    for (const bytes of raw) bytes.fill(0xff);
    const second = make([Buffer.alloc(32), Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22),
      Buffer.alloc(32, 0x33), Buffer.alloc(32, 0x44)]);
    const rootOf = (input: SQLiteCursorPreRebindIssueInput) =>
      assertSQLiteCursorPreRebindReceiptProvenance(
        new SQLiteCursorPreRebindReceiptIssuer(input).issue(input),
      ).receiptSha256;
    expect(rootOf(first)).toBe(rootOf(second));
  });

  it("stays private and performs no database, TEMP, migration or rebind operation", () => {
    expect(Object.keys(sqlitePackage)).not.toContain("SQLiteCursorPreRebindReceiptIssuer");
    const source = readFileSync(new URL("../src/operation-baseline-cursor-ownership.ts", import.meta.url), "utf8");
    for (const banned of [".prepare(", ".execTrusted(", "CREATE TEMP", "0002", "UPDATE ge_cycle_cursors"])
      expect(source).not.toContain(banned);
  });
});
