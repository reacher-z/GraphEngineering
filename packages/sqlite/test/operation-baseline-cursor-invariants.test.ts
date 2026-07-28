import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { describe, expect, it } from "vitest";

import * as sqlitePackage from "../src/index.js";
import {
  MAX_SQLITE_CURSOR_PAGE_SIZE,
  MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES,
  MAX_SQLITE_CURSOR_SNAPSHOT_BYTES,
  MIN_SQLITE_CURSOR_BLOB_BYTES,
  MIN_SQLITE_CURSOR_PAGE_SIZE,
  SQLITE_CURSOR_COLUMN_COUNT,
  SQLITE_CURSOR_KINDS,
  SQLITE_CURSOR_SEAL_CARRIER_FIELDS,
  SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
  SQLITE_CURSOR_SEAL_DOMAIN,
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  SQLITE_CURSOR_SEAL_ROW_DOMAIN,
  SQLITE_CURSOR_SEAL_SOURCE_COLUMNS,
  SQLiteCursorSealAccumulator,
  type SQLiteCursorSealCarrier,
  type SQLiteCursorSealRow,
  decodeSQLiteCursorSealRow,
  digestSQLiteCursorSealCarrier,
  encodeSQLiteCursorSealCarrier,
  sealSQLiteCursorRows,
  validateSQLiteCursorSealCarrier,
} from "../src/operation-baseline-cursor-invariants.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);

const EVENT_SCOPE_TEXT =
  '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"stream-alpha"}';
const EVENT_SNAPSHOT_TEXT = `{"recordHash":"${D}","sequence":6}`;
const CHECKPOINT_SCOPE_TEXT = '{"checkpointScope":"checkpoint-scope",'
  + '"contractVersion":"cycle-store-provider/v1alpha1","pageSize":16}';
const CHECKPOINT_SNAPSHOT_TEXT =
  '[{"checkpointId":"cp-b","checkpointScope":"checkpoint-scope","revision":2},'
  + '{"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","revision":1}]';

// Independently derived once, by hand, from the frozen algorithm before the
// module was consulted; the local re-derivation below repeats it in this file.
const GENESIS_STATE = "c34613edbaec5c6bd6308364bc4c70f3126cf5191ba77147b97c743750dec9a7";
const EMPTY_ROOT = "587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f";
const EVENT_ROW_DIGEST = "199c16459c659c58817955efa0336150a5771518f131a9156b45712681b0d3c1";
const EVENT_ROOT = "1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea";
const CHECKPOINT_ROOT = "4fefb119ba4e71217c64470627ce9b07388ffdd29cf0b3549b7127b06436f5f6";
const PAIR_ROOT = "3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1";
const FLEET_128_ROOT = "ea6cf138d7d4f78169adfa6110302e5e174f1cefd71b887af05e79ca0103bd8a";
const FLEET_1024_ROOT = "2d9327dc17dadaf43c3643b853d38ea09e0e396d7005e553a5a5e88469b3857f";

const EVENT_CARRIER_TEXT = '{'
  + `"authorizationHash":"${C}",`
  + '"checkpointScope":null,'
  + '"consumedAtMs":null,'
  + '"createdAtMs":1700000000000,'
  + '"expiresAtMs":1700000300000,'
  + '"kind":"event",'
  + '"nextPosition":7,'
  + '"pageSize":64,'
  + `"principalHash":"${B}",`
  + '"requestScopeBlobSha256":'
  + '"d00f1fc2dce4f060663fc435ff29b67bd604a56df512036e9ac70315c602b0d3",'
  + '"requestScopeByteLength":91,'
  + '"snapshotBlobSha256":'
  + '"f76ef54a5245a5d0729d70805c1d13b32e2ed69e48d95fcffcb7b01f4a982910",'
  + '"snapshotByteLength":94,'
  + `"snapshotTailRecordHash":"${D}",`
  + '"snapshotTailSequence":6,'
  + '"streamId":"stream-alpha",'
  + '"tenantId":"tenant-alpha",'
  + `"tokenHash":"${A}"`
  + '}';

const CHECKPOINT_CARRIER_TEXT = '{'
  + `"authorizationHash":"${D}",`
  + '"checkpointScope":"checkpoint-scope",'
  + '"consumedAtMs":1700000100000,'
  + '"createdAtMs":1700000000000,'
  + '"expiresAtMs":1700000300000,'
  + '"kind":"checkpoint",'
  + '"nextPosition":2,'
  + '"pageSize":16,'
  + `"principalHash":"${C}",`
  + '"requestScopeBlobSha256":'
  + '"8a3f9f0839bcbbf3307a9509cfa1253c2336bc064aef7a8cf08c1faec7001e4c",'
  + '"requestScopeByteLength":102,'
  + '"snapshotBlobSha256":'
  + '"36af5ba0db281eaaacc972b8663a752f4c70097544465d41edfca8594f5e814a",'
  + '"snapshotByteLength":149,'
  + '"snapshotTailRecordHash":null,'
  + '"snapshotTailSequence":null,'
  + '"streamId":null,'
  + '"tenantId":"tenant-beta",'
  + `"tokenHash":"${B}"`
  + '}';

const EVENT_ROW: readonly unknown[] = Object.freeze([
  "tenant-alpha", A, "event", B, C, "stream-alpha", null,
  Buffer.from(EVENT_SCOPE_TEXT, "utf8"), 64n, 7n, 6n, D, E, F,
  Buffer.from(EVENT_SNAPSHOT_TEXT, "utf8"), 1_700_000_000_000n, 1_700_000_300_000n, null,
]);

const CHECKPOINT_ROW: readonly unknown[] = Object.freeze([
  "tenant-beta", B, "checkpoint", C, D, null, "checkpoint-scope",
  Buffer.from(CHECKPOINT_SCOPE_TEXT, "utf8"), 16n, 2n, null, null, E, F,
  Buffer.from(CHECKPOINT_SNAPSHOT_TEXT, "utf8"),
  1_700_000_000_000n, 1_700_000_300_000n, 1_700_000_100_000n,
]);

const MODULE_SOURCE = readFileSync(
  new URL("../src/operation-baseline-cursor-invariants.ts", import.meta.url),
  "utf8",
);

/** Replace one physical column of a frozen row fixture. */
function column(row: readonly unknown[], index: number, value: unknown): unknown[] {
  const next = [...row];
  next[index] = value;
  return next;
}

function carrierOf(row: readonly unknown[]): SQLiteCursorSealCarrier {
  return decodeSQLiteCursorSealRow(row).carrier;
}

function rowOf(row: readonly unknown[]): SQLiteCursorSealRow {
  return decodeSQLiteCursorSealRow(row);
}

/** Seal already ordered physical rows and return only the immutable root. */
function rootOfRows(...rows: readonly (readonly unknown[])[]): string {
  const accumulator = new SQLiteCursorSealAccumulator(rows.length, E, F);
  for (const row of rows) accumulator.append(rowOf(row));
  return accumulator.finish().immutableRootSha256;
}

function rootOfCarrier(carrier: SQLiteCursorSealCarrier): string {
  const accumulator = new SQLiteCursorSealAccumulator(1, E, F);
  accumulator.append({ carrier, descriptorHash: E, schemaIdentitySha256: F });
  return accumulator.finish().immutableRootSha256;
}

/** A second, deliberately independent implementation of the frozen algorithm. */
function independentRoot(carrierTexts: readonly string[]): string {
  const rowDomain = Buffer.from("graph-engineering/sqlite-cursor-seal-row/v1\0", "utf8");
  const sealDomain = Buffer.from("graph-engineering/sqlite-cursor-seal/v1\0", "utf8");
  const u64 = (value: number): Buffer => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(BigInt(value));
    return bytes;
  };
  const sha = (value: Buffer): Buffer => createHash("sha256").update(value).digest();
  let state = sha(Buffer.concat([sealDomain, Buffer.of(0x00)]));
  for (const [index, text] of carrierTexts.entries()) {
    const bytes = Buffer.from(text, "utf8");
    const digest = sha(Buffer.concat([rowDomain, u64(bytes.byteLength), bytes]));
    state = sha(Buffer.concat([sealDomain, Buffer.of(0x01), state, u64(index + 1), digest]));
  }
  return sha(
    Buffer.concat([sealDomain, Buffer.of(0x02), u64(carrierTexts.length), state]),
  ).toString("hex");
}

function providerError(run: () => unknown): CycleStoreProviderError {
  try {
    run();
  } catch (error) {
    if (error instanceof CycleStoreProviderError) return error;
    throw error;
  }
  throw new Error("expected a CycleStoreProviderError");
}

function fleetRow(index: number): unknown[] {
  const snapshot = Buffer.from(`{"recordHash":"${D}","sequence":${index}}`, "utf8");
  return [
    "tenant-fleet",
    index.toString(16).padStart(64, "0"),
    "event", B, C, "stream-fleet", null,
    Buffer.from(
      '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":32,"streamId":"stream-fleet"}',
      "utf8",
    ),
    32n, BigInt(index), BigInt(index), D, E, F, snapshot,
    BigInt(1_700_000_000_000 + index), BigInt(1_700_000_300_000 + index), null,
  ];
}

interface LiveCarrierProbe {
  current: number;
  max: number;
}

/** Yields one decoded cursor at a time and records peak simultaneous liveness. */
function* fleetRows(count: number, probe: LiveCarrierProbe): Generator<SQLiteCursorSealRow> {
  for (let index = 0; index < count; index += 1) {
    const decoded = decodeSQLiteCursorSealRow(fleetRow(index));
    probe.current += 1;
    probe.max = Math.max(probe.max, probe.current);
    yield decoded;
    probe.current -= 1;
  }
}

describe("SQLite cursor seal byte protocol", () => {
  it("freezes both domains, the eighteen-column reader and the closed carrier", () => {
    expect(SQLITE_CURSOR_SEAL_ROW_DOMAIN).toBe("graph-engineering/sqlite-cursor-seal-row/v1\0");
    expect(SQLITE_CURSOR_SEAL_DOMAIN).toBe("graph-engineering/sqlite-cursor-seal/v1\0");
    expect(SQLITE_CURSOR_COLUMN_COUNT).toBe(18);
    expect(SQLITE_CURSOR_SEAL_SOURCE_COLUMNS).toHaveLength(18);
    expect(SQLITE_CURSOR_SEAL_CARRIER_FIELDS).toHaveLength(18);
    expect(SQLITE_CURSOR_KINDS).toEqual(["event", "checkpoint"]);
    expect(MIN_SQLITE_CURSOR_BLOB_BYTES).toBe(2);
    expect(MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES).toBe(1_048_576);
    expect(MAX_SQLITE_CURSOR_SNAPSHOT_BYTES).toBe(16_777_216);
    expect([MIN_SQLITE_CURSOR_PAGE_SIZE, MAX_SQLITE_CURSOR_PAGE_SIZE]).toEqual([1, 256]);

    // The carrier holds the fourteen non-BLOB immutable scalars plus one byte
    // length and one digest per BLOB, and never the two rebindable identities.
    expect([...SQLITE_CURSOR_SEAL_CARRIER_FIELDS]).toEqual([
      "authorizationHash", "checkpointScope", "consumedAtMs", "createdAtMs", "expiresAtMs",
      "kind", "nextPosition", "pageSize", "principalHash", "requestScopeBlobSha256",
      "requestScopeByteLength", "snapshotBlobSha256", "snapshotByteLength",
      "snapshotTailRecordHash", "snapshotTailSequence", "streamId", "tenantId", "tokenHash",
    ]);
    expect(SQLITE_CURSOR_SEAL_CARRIER_FIELDS).not.toContain("descriptorHash");
    expect(SQLITE_CURSOR_SEAL_CARRIER_FIELDS).not.toContain("schemaIdentitySha256");
  });

  it("matches the physical schema-v1 cursor column inventory and order", () => {
    const schema = readFileSync(new URL("../migrations/schema-v1.sql", import.meta.url), "utf8");
    const start = schema.indexOf("CREATE TABLE ge_cycle_cursors (");
    const block = schema.slice(start, schema.indexOf("\n) STRICT", start));
    const columns = [...block.matchAll(/^ {2}([a-z0-9_]+) (?:TEXT|INTEGER|BLOB)\b/gmu)]
      .map((match) => match[1]);
    expect(columns).toEqual([...SQLITE_CURSOR_SEAL_SOURCE_COLUMNS]);
  });

  it("derives the literal empty, event, checkpoint and paired roots", () => {
    expect(createHash("sha256")
      .update(Buffer.from(SQLITE_CURSOR_SEAL_DOMAIN, "utf8"))
      .update(Buffer.of(0x00))
      .digest("hex")).toBe(GENESIS_STATE);

    expect(independentRoot([])).toBe(EMPTY_ROOT);
    expect(independentRoot([EVENT_CARRIER_TEXT])).toBe(EVENT_ROOT);
    expect(independentRoot([CHECKPOINT_CARRIER_TEXT])).toBe(CHECKPOINT_ROOT);
    expect(independentRoot([EVENT_CARRIER_TEXT, CHECKPOINT_CARRIER_TEXT])).toBe(PAIR_ROOT);

    expect(SQLITE_CURSOR_SEAL_EMPTY_ROOT).toBe(EMPTY_ROOT);
    expect(new SQLiteCursorSealAccumulator(0, E, F).finish()).toEqual({
      cursorCount: 0,
      immutableRootSha256: EMPTY_ROOT,
      sourceDescriptorHash: E,
      sourceSchemaIdentitySha256: F,
    });
    expect(rootOfRows(EVENT_ROW)).toBe(EVENT_ROOT);
    expect(rootOfRows(CHECKPOINT_ROW)).toBe(CHECKPOINT_ROOT);
    expect(rootOfRows(EVENT_ROW, CHECKPOINT_ROW)).toBe(PAIR_ROOT);
    expect(new Set([EMPTY_ROOT, EVENT_ROOT, CHECKPOINT_ROOT, PAIR_ROOT]).size).toBe(4);
  });

  it("encodes canonical carrier bytes and the domain-separated row digest", () => {
    const eventCarrier = carrierOf(EVENT_ROW);
    const carrierBytes = encodeSQLiteCursorSealCarrier(eventCarrier);
    expect(carrierBytes.toString("utf8")).toBe(EVENT_CARRIER_TEXT);
    expect(carrierBytes.byteLength).toBe(796);
    expect(encodeSQLiteCursorSealCarrier(carrierOf(CHECKPOINT_ROW)).toString("utf8"))
      .toBe(CHECKPOINT_CARRIER_TEXT);

    const digest = digestSQLiteCursorSealCarrier(eventCarrier);
    expect(digest).toHaveLength(32);
    expect(digest.toString("hex")).toBe(EVENT_ROW_DIGEST);
    expect(createHash("sha256")
      .update(Buffer.from(SQLITE_CURSOR_SEAL_ROW_DOMAIN, "utf8"))
      .update(Buffer.from("000000000000031c", "hex"))
      .update(carrierBytes)
      .digest("hex")).toBe(EVENT_ROW_DIGEST);

    // The carrier is a detached, deeply frozen snapshot of the physical row.
    expect(Object.isFrozen(eventCarrier)).toBe(true);
    expect(Object.keys(eventCarrier)).toHaveLength(18);
    expect(eventCarrier.requestScopeByteLength).toBe(91);
    expect(eventCarrier.snapshotByteLength).toBe(94);
    expect(validateSQLiteCursorSealCarrier(eventCarrier)).toEqual(eventCarrier);
  });

  it("excludes descriptor and schema identity from the carrier and the root", () => {
    const source = rowOf(EVENT_ROW);
    const rebound = rowOf(column(column(EVENT_ROW, 12, A), 13, B));
    expect(source.descriptorHash).toBe(E);
    expect(source.schemaIdentitySha256).toBe(F);
    expect(rebound.descriptorHash).toBe(A);
    expect(rebound.schemaIdentitySha256).toBe(B);
    expect(encodeSQLiteCursorSealCarrier(rebound.carrier).toString("utf8"))
      .toBe(EVENT_CARRIER_TEXT);
    const reboundAccumulator = new SQLiteCursorSealAccumulator(1, A, B);
    reboundAccumulator.append(rebound);
    const reboundReceipt = reboundAccumulator.finish();
    expect(reboundReceipt.immutableRootSha256).toBe(EVENT_ROOT);
    expect(reboundReceipt.sourceDescriptorHash).toBe(A);
    expect(reboundReceipt.sourceSchemaIdentitySha256).toBe(B);
    expect(() => new SQLiteCursorSealAccumulator(1, E, F).append(rebound))
      .toThrow(CycleStoreProviderError);

    // Both identities are still strictly bound rather than ignored.
    expect(() => rowOf(column(EVENT_ROW, 12, "E".repeat(64)))).toThrow(CycleStoreProviderError);
    expect(() => rowOf(column(EVENT_ROW, 13, null))).toThrow(CycleStoreProviderError);
    expect(() => new SQLiteCursorSealAccumulator(1, E, F)
      .append({ carrier: source.carrier, descriptorHash: "short", schemaIdentitySha256: F }))
      .toThrow(CycleStoreProviderError);
  });

  it("changes the root for every immutable carrier contribution", () => {
    const eventCarrier = carrierOf(EVENT_ROW);
    const flips: readonly Partial<SQLiteCursorSealCarrier>[] = [
      { authorizationHash: D },
      { consumedAtMs: 1_700_000_100_000 },
      { createdAtMs: 1_699_999_999_999 },
      { expiresAtMs: 1_700_000_300_001 },
      { nextPosition: 8 },
      { pageSize: 65 },
      { principalHash: A },
      { requestScopeBlobSha256: A },
      { requestScopeByteLength: 92 },
      { snapshotBlobSha256: A },
      { snapshotByteLength: 95 },
      { snapshotTailRecordHash: A },
      { snapshotTailSequence: 5 },
      { streamId: "stream-alphb" },
      { tenantId: "tenant-alphb" },
      { tokenHash: B },
    ];
    const roots = new Set([rootOfCarrier(eventCarrier)]);
    for (const flip of flips) roots.add(rootOfCarrier({ ...eventCarrier, ...flip }));
    expect(roots.size).toBe(flips.length + 1);

    // `checkpointScope` and `kind` only vary legally on a checkpoint carrier.
    const checkpointCarrier = carrierOf(CHECKPOINT_ROW);
    expect(rootOfCarrier({ ...checkpointCarrier, checkpointScope: "checkpoint-scobe" }))
      .not.toBe(rootOfCarrier(checkpointCarrier));
    expect(EVENT_CARRIER_TEXT).toContain('"kind":"event"');
    expect(CHECKPOINT_CARRIER_TEXT).toContain('"kind":"checkpoint"');
    expect(EVENT_ROOT).not.toBe(CHECKPOINT_ROOT);
  });

  it("changes the root for BLOB length and same-length BLOB content attacks", () => {
    const baseline = rootOfRows(EVENT_ROW);
    const sameLengthScope = column(EVENT_ROW, 7, Buffer.from(
      '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"stream-alphz"}',
      "utf8",
    ));
    const longerScope = column(EVENT_ROW, 7, Buffer.from(
      '{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":256,"streamId":"stream-alpha"}',
      "utf8",
    ));
    const sameLengthSnapshot = column(EVENT_ROW, 14, Buffer.from(
      `{"recordHash":"${A}","sequence":6}`, "utf8",
    ));
    const longerSnapshot = column(EVENT_ROW, 14, Buffer.from(
      `{"recordHash":"${D}","sequence":60}`, "utf8",
    ));

    expect(carrierOf(sameLengthScope).requestScopeByteLength).toBe(91);
    expect(carrierOf(sameLengthScope).requestScopeBlobSha256)
      .not.toBe(carrierOf(EVENT_ROW).requestScopeBlobSha256);
    expect(carrierOf(longerScope).requestScopeByteLength).toBe(92);
    expect(carrierOf(sameLengthSnapshot).snapshotByteLength).toBe(94);
    expect(carrierOf(longerSnapshot).snapshotByteLength).toBe(95);
    expect(new Set([
      baseline,
      rootOfRows(sameLengthScope),
      rootOfRows(longerScope),
      rootOfRows(sameLengthSnapshot),
      rootOfRows(longerSnapshot),
    ]).size).toBe(5);
  });

  it("seals checkpoint snapshot order inside the same-length snapshot digest", () => {
    const reordered = column(CHECKPOINT_ROW, 14, Buffer.from(
      '[{"checkpointId":"cp-a","checkpointScope":"checkpoint-scope","revision":1},'
      + '{"checkpointId":"cp-b","checkpointScope":"checkpoint-scope","revision":2}]',
      "utf8",
    ));
    expect(carrierOf(reordered).snapshotByteLength).toBe(149);
    expect(carrierOf(reordered).snapshotBlobSha256)
      .not.toBe(carrierOf(CHECKPOINT_ROW).snapshotBlobSha256);
    expect(rootOfRows(reordered)).not.toBe(CHECKPOINT_ROOT);
  });

  it("rejects noncanonical, BOM-prefixed, invalid UTF-8 and out-of-bound BLOBs", () => {
    const scope = (text: string | Uint8Array): unknown[] => column(
      EVENT_ROW, 7, typeof text === "string" ? Buffer.from(text, "utf8") : text,
    );
    const rejected: readonly unknown[][] = [
      scope(Buffer.concat([Buffer.of(0xef, 0xbb, 0xbf), Buffer.from(EVENT_SCOPE_TEXT, "utf8")])),
      scope(Buffer.of(0x7b, 0xff, 0x7d)),
      scope('{"pageSize":64,"pageSize":64}'),
      scope('{"pageSize": 64}'),
      scope('{"streamId":"stream-alpha","pageSize":64}'),
      scope('{"pageSize":64}\n'),
      scope("[1,2,]"),
      scope(Buffer.of(0x31)),
      scope(Buffer.alloc(MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES + 1, 0x20)),
      scope("not json at all"),
      column(EVENT_ROW, 7, EVENT_SCOPE_TEXT),
      column(EVENT_ROW, 14, Buffer.from(`{ "recordHash":"${D}","sequence":6}`, "utf8")),
      column(EVENT_ROW, 14, Buffer.of(0x7b)),
    ];
    for (const row of rejected) {
      expect(() => decodeSQLiteCursorSealRow(row)).toThrow(CycleStoreProviderError);
    }

    // The two-byte canonical minimum is accepted on both BLOB columns.
    expect(carrierOf(column(column(EVENT_ROW, 7, Buffer.from("{}", "utf8")), 14,
      Buffer.from("[]", "utf8"))).requestScopeByteLength).toBe(2);
    expect(() => validateSQLiteCursorSealCarrier({
      ...carrierOf(EVENT_ROW),
      snapshotByteLength: MAX_SQLITE_CURSOR_SNAPSHOT_BYTES + 1,
    })).toThrow(CycleStoreProviderError);
  });

  it("enforces the closed row arity, storage classes and lexical bounds", () => {
    expect(() => decodeSQLiteCursorSealRow([...EVENT_ROW].slice(0, 17))
      ).toThrow(CycleStoreProviderError);
    expect(() => decodeSQLiteCursorSealRow([...EVENT_ROW, null])).toThrow(CycleStoreProviderError);
    expect(() => decodeSQLiteCursorSealRow({ ...EVENT_ROW })).toThrow(CycleStoreProviderError);

    const rejected: readonly unknown[][] = [
      column(EVENT_ROW, 0, ""),
      column(EVENT_ROW, 0, "tenant alpha"),
      column(EVENT_ROW, 0, `t${"a".repeat(128)}`),
      column(EVENT_ROW, 0, null),
      column(EVENT_ROW, 1, "A".repeat(64)),
      column(EVENT_ROW, 1, "a".repeat(63)),
      column(EVENT_ROW, 2, "events"),
      column(EVENT_ROW, 3, `${"a".repeat(63)}g`),
      column(EVENT_ROW, 4, null),
      column(EVENT_ROW, 8, 0n),
      column(EVENT_ROW, 8, 257n),
      column(EVENT_ROW, 8, 64),
      column(EVENT_ROW, 9, -1n),
      column(EVENT_ROW, 9, 9_007_199_254_740_992n),
      column(EVENT_ROW, 10, -2n),
      column(EVENT_ROW, 11, "D".repeat(64)),
    ];
    for (const row of rejected) {
      expect(() => decodeSQLiteCursorSealRow(row)).toThrow(CycleStoreProviderError);
    }

    // Both page-size boundaries stay valid and observably distinct.
    expect(carrierOf(column(EVENT_ROW, 8, 1n)).pageSize).toBe(MIN_SQLITE_CURSOR_PAGE_SIZE);
    expect(carrierOf(column(EVENT_ROW, 8, 256n)).pageSize).toBe(MAX_SQLITE_CURSOR_PAGE_SIZE);
    expect(rootOfRows(column(EVENT_ROW, 8, 1n)))
      .not.toBe(rootOfRows(column(EVENT_ROW, 8, 256n)));
  });

  it("enforces the event and checkpoint scope, tail and nullability groups", () => {
    const rejected: readonly unknown[][] = [
      column(EVENT_ROW, 5, null),
      column(EVENT_ROW, 6, "checkpoint-scope"),
      column(EVENT_ROW, 10, null),
      column(EVENT_ROW, 11, null),
      column(column(EVENT_ROW, 10, -1n), 11, D),
      column(CHECKPOINT_ROW, 5, "stream-alpha"),
      column(CHECKPOINT_ROW, 6, null),
      column(CHECKPOINT_ROW, 10, 0n),
      column(CHECKPOINT_ROW, 11, D),
    ];
    for (const row of rejected) {
      expect(() => decodeSQLiteCursorSealRow(row)).toThrow(CycleStoreProviderError);
    }

    // The empty event tail sentinel is the one legal null tail hash.
    const empty = carrierOf(column(column(EVENT_ROW, 10, -1n), 11, null));
    expect([empty.snapshotTailSequence, empty.snapshotTailRecordHash]).toEqual([-1, null]);
    expect(rootOfRows(column(column(EVENT_ROW, 10, -1n), 11, null))).not.toBe(EVENT_ROOT);
  });

  it("enforces safe-integer clock edges and the expiry/consumption ordering", () => {
    const rejected: readonly unknown[][] = [
      column(EVENT_ROW, 16, 1_700_000_000_000n),
      column(EVENT_ROW, 16, 1_699_999_999_999n),
      column(EVENT_ROW, 17, 1_699_999_999_999n),
      column(EVENT_ROW, 15, -1n),
      column(EVENT_ROW, 15, null),
      column(EVENT_ROW, 16, null),
      column(EVENT_ROW, 17, 9_007_199_254_740_992n),
    ];
    for (const row of rejected) {
      expect(() => decodeSQLiteCursorSealRow(row)).toThrow(CycleStoreProviderError);
    }

    const edges = carrierOf(column(column(column(
      EVENT_ROW, 15, 0n), 16, 9_007_199_254_740_991n), 17, 0n));
    expect([edges.createdAtMs, edges.expiresAtMs, edges.consumedAtMs])
      .toEqual([0, Number.MAX_SAFE_INTEGER, 0]);
    expect(carrierOf(column(EVENT_ROW, 17, 1_700_000_000_000n)).consumedAtMs)
      .toBe(1_700_000_000_000);
  });

  it("rejects carriers that are not closed, portable and safely inspectable", () => {
    const carrier = carrierOf(EVENT_ROW);
    const rejected: readonly unknown[] = [
      null,
      "carrier",
      [carrier],
      { ...carrier, extra: true },
      { ...carrier, tokenHash: undefined },
      { ...carrier, nextPosition: 1.5 },
      { ...carrier, nextPosition: 9_007_199_254_740_992 },
      { ...carrier, createdAtMs: Number.NaN },
      { ...carrier, tenantId: 1 },
      Object.defineProperty({ ...carrier }, "tenantId", { get: () => "tenant-alpha" }),
    ];
    for (const value of rejected) {
      expect(() => validateSQLiteCursorSealCarrier(value)).toThrow(CycleStoreProviderError);
    }
    const { tokenHash: _removed, ...missing } = carrier;
    expect(() => validateSQLiteCursorSealCarrier(missing)).toThrow(CycleStoreProviderError);
  });

  it("keeps tenant, token, stream and BLOB plaintext out of every diagnostic", () => {
    const tenant = "tenant-confidential";
    const token = "9".repeat(64);
    const stream = "stream-confidential";
    const payload = `{"secret":"do-not-log","streamId":"${stream}"}`;
    const secret = Object.freeze([
      tenant, token, "event", B, C, stream, null, Buffer.from(payload, "utf8"),
      64n, 7n, 6n, D, E, F, Buffer.from(payload, "utf8"),
      1_700_000_000_000n, 1_700_000_300_000n, null,
    ]);
    const failures: readonly (() => unknown)[] = [
      () => decodeSQLiteCursorSealRow(column(secret, 8, 0n)),
      () => decodeSQLiteCursorSealRow(column(secret, 16, 1n)),
      () => decodeSQLiteCursorSealRow(column(secret, 7, Buffer.from(` ${payload}`, "utf8"))),
      () => decodeSQLiteCursorSealRow(column(secret, 2, "unknown")),
      () => decodeSQLiteCursorSealRow([...secret].slice(0, 17)),
      () => decodeSQLiteCursorSealRow(column(secret, 6, "checkpoint-scope")),
    ];
    for (const failure of failures) {
      const error = providerError(failure);
      const exposed = `${error.message}|${JSON.stringify(error.details)}`;
      expect(error.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(error.operation).toBe("inspect-schema");
      expect(exposed).not.toContain(tenant);
      expect(exposed).not.toContain(token);
      expect(exposed).not.toContain(stream);
      expect(exposed).not.toContain("do-not-log");
      expect(exposed).not.toContain("secret");
    }
  });
});

describe("SQLite cursor seal accumulator", () => {
  it("orders by token-hash bytes first and then tenant bytes", () => {
    // The two orders disagree: token `a…` belongs to the lexically later tenant.
    const firstByToken = column(EVENT_ROW, 0, "tenant-zulu");
    const secondByToken = column(CHECKPOINT_ROW, 0, "tenant-alpha");
    expect(() => rootOfRows(firstByToken, secondByToken)).not.toThrow();
    expect(providerError(() => rootOfRows(secondByToken, firstByToken)).message)
      .toBe("SQLite cursor seal order is invalid");

    // One token hash shared across tenants still breaks the tie on tenant bytes.
    const sharedLow = column(CHECKPOINT_ROW, 0, "tenant-alpha");
    const sharedHigh = column(CHECKPOINT_ROW, 0, "tenant-beta");
    expect(() => rootOfRows(sharedLow, sharedHigh)).not.toThrow();
    expect(() => rootOfRows(sharedHigh, sharedLow)).toThrow(CycleStoreProviderError);
    expect(rootOfRows(sharedLow, sharedHigh)).not.toBe(PAIR_ROOT);
  });

  it("rejects duplicate identities, regressions and overflow atomically", () => {
    const accumulator = new SQLiteCursorSealAccumulator(2, E, F);
    accumulator.append(rowOf(EVENT_ROW));
    expect(accumulator.cursorCount).toBe(1);

    expect(providerError(() => accumulator.append(rowOf(EVENT_ROW))).message)
      .toBe("SQLite cursor seal duplicate identity is invalid");
    expect(() => accumulator.append(rowOf(column(EVENT_ROW, 1, "0".repeat(64)))))
      .toThrow(CycleStoreProviderError);
    expect(() => accumulator.append({
      carrier: { ...carrierOf(CHECKPOINT_ROW), pageSize: 0 },
      descriptorHash: E,
      schemaIdentitySha256: F,
    })).toThrow(CycleStoreProviderError);
    expect(accumulator.cursorCount).toBe(1);

    // Every rejected append left the chain, the count and the root untouched.
    accumulator.append(rowOf(CHECKPOINT_ROW));
    expect(accumulator.cursorCount).toBe(2);
    expect(accumulator.finish().immutableRootSha256).toBe(PAIR_ROOT);

    const overflowing = new SQLiteCursorSealAccumulator(1, E, F);
    overflowing.append(rowOf(EVENT_ROW));
    expect(providerError(() => overflowing.append(rowOf(CHECKPOINT_ROW))).message)
      .toBe("SQLite cursor seal count overflow is invalid");
    expect(overflowing.cursorCount).toBe(1);
    expect(overflowing.finish().immutableRootSha256).toBe(EVENT_ROOT);
  });

  it("rejects underflow, an invalid expected count and post-finish appends", () => {
    expect(() => new SQLiteCursorSealAccumulator(-1, E, F)).toThrow(CycleStoreProviderError);
    expect(providerError(() => new SQLiteCursorSealAccumulator(1.5, E, F)).code)
      .toBe("GE_CYCLE_STORE_INVALID_ARGUMENT");

    const truncated = new SQLiteCursorSealAccumulator(2, E, F);
    truncated.append(rowOf(EVENT_ROW));
    expect(providerError(() => truncated.finish()).message)
      .toBe("SQLite cursor seal count underflow is invalid");
    expect(truncated.isFinished).toBe(false);
    expect(() => truncated.finish()).toThrow(CycleStoreProviderError);

    const finished = new SQLiteCursorSealAccumulator(1, E, F);
    finished.append(rowOf(EVENT_ROW));
    const receipt = finished.finish();
    expect(finished.isFinished).toBe(true);
    expect(() => finished.finish()).toThrow(CycleStoreProviderError);
    expect(providerError(() => finished.append(rowOf(CHECKPOINT_ROW))).code)
      .toBe("GE_CYCLE_STORE_INVALID_ARGUMENT");
    expect(finished.cursorCount).toBe(1);
    expect(receipt.immutableRootSha256).toBe(EVENT_ROOT);
  });

  it("returns a deeply frozen, fixed-size receipt at every cursor count", () => {
    const probe: LiveCarrierProbe = { current: 0, max: 0 };
    const receipts = [
      new SQLiteCursorSealAccumulator(0, E, F).finish(),
      sealSQLiteCursorRows(1, E, F, [rowOf(EVENT_ROW)]),
      sealSQLiteCursorRows(2, E, F, [rowOf(EVENT_ROW), rowOf(CHECKPOINT_ROW)]),
      sealSQLiteCursorRows(128, E, F, fleetRows(128, probe)),
    ];
    for (const receipt of receipts) {
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(Object.keys(receipt)).toEqual([
        "cursorCount", "immutableRootSha256",
        "sourceDescriptorHash", "sourceSchemaIdentitySha256",
      ]);
      expect(SQLITE_CURSOR_SEAL_ALGORITHM_VERSION).toBe("sqlite-cursor-seal/v1");
      expect(typeof receipt.immutableRootSha256).toBe("string");
      expect(receipt.immutableRootSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(() => {
        (receipt as { cursorCount: number }).cursorCount = -1;
      }).toThrow(TypeError);
    }
    expect(receipts.map((receipt) => receipt.cursorCount)).toEqual([0, 1, 2, 128]);
  });

  it("streams 128 and 1,024 synthetic cursors with one live carrier", () => {
    const small: LiveCarrierProbe = { current: 0, max: 0 };
    expect(sealSQLiteCursorRows(128, E, F, fleetRows(128, small)).immutableRootSha256)
      .toBe(FLEET_128_ROOT);
    expect([small.max, small.current]).toEqual([1, 0]);

    const large: LiveCarrierProbe = { current: 0, max: 0 };
    expect(sealSQLiteCursorRows(1_024, E, F, fleetRows(1_024, large)).immutableRootSha256)
      .toBe(FLEET_1024_ROOT);
    expect([large.max, large.current]).toEqual([1, 0]);
    expect(FLEET_128_ROOT).not.toBe(FLEET_1024_ROOT);

    const idle: LiveCarrierProbe = { current: 0, max: 0 };
    expect(() => sealSQLiteCursorRows(127, E, F, fleetRows(128, idle)))
      .toThrow(CycleStoreProviderError);
    expect(() => sealSQLiteCursorRows(129, E, F, fleetRows(128, idle)))
      .toThrow(CycleStoreProviderError);
  });

  it("owns no SQL and keeps the module free of collections that grow with N", () => {
    for (const banned of [
      ".all(", "fetchall", "Array.from", ".sort(", "new Map", "new Set", ".push(",
      ".concat(", "SELECT ", "INSERT ", "UPDATE ", "CREATE ", "prepare(",
    ]) {
      expect(MODULE_SOURCE).not.toContain(banned);
    }
  });

  it("stays private to the package and is never re-exported from the index", () => {
    const exported = Object.keys(sqlitePackage);
    expect(exported.some((key) => key.toLowerCase().includes("cursor"))).toBe(false);
    expect(exported).not.toContain("SQLiteCursorSealAccumulator");
    expect(exported).not.toContain("decodeSQLiteCursorSealRow");
    expect(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8"))
      .not.toContain("cursor-invariants");
  });
});
