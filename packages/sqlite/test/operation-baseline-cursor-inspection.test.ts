import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "@graph-engineering/core";

import { inspectSQLiteCursorRow } from "../src/operation-baseline-cursor-inspection.js";

interface LiteralFixture {
  readonly literalRows: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
const fixture = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/sqlite-cursor-pre-rebind-v1.case.json", import.meta.url),
  "utf8",
)) as LiteralFixture;

function physical(name: string): unknown[] {
  const row = fixture.literalRows[name]!;
  return [
    row["tenant_id"], row["token_hash"], row["kind"], row["principal_hash"],
    row["authorization_hash"], row["stream_id"], row["checkpoint_scope"],
    Buffer.from(String(row["request_scope_blob_utf8"])), BigInt(row["page_size"] as number),
    BigInt(row["next_position"] as number), row["snapshot_tail_sequence"] === null
      ? null : BigInt(row["snapshot_tail_sequence"] as number),
    row["snapshot_tail_record_hash"], row["descriptor_hash"], row["schema_identity_sha256"],
    Buffer.from(String(row["snapshot_blob_utf8"])), BigInt(row["created_at_ms"] as number),
    BigInt(row["expires_at_ms"] as number), row["consumed_at_ms"] === null
      ? null : BigInt(row["consumed_at_ms"] as number),
  ];
}

const context = {
  sourceOrdinal: 1,
  sourceDescriptorHash: "e".repeat(64),
  sourceSchemaIdentitySha256: "f".repeat(64),
  providerHighWaterAtMs: 1_700_000_100_000,
  eventTailExists: () => true,
  checkpointPutExists: () => true,
} as const;
const flags = (row: unknown[]): readonly unknown[] =>
  inspectSQLiteCursorRow(row, context).stageValues.slice(20);

describe("SQLite cursor tolerant row inspector", () => {
  it("assigns isolated hostile evidence to the frozen rules without cascades", () => {
    const pristine = physical("eventEmpty");
    expect(flags(pristine)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

    const authorization = [...pristine]; authorization[1] = "bad";
    expect(flags(authorization)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 0]);

    const scope = [...pristine];
    scope[7] = Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","extra":true,"pageSize":64,"streamId":"stream-alpha"}');
    expect(flags(scope)).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 1, 0]);

    const blob = [...pristine]; blob[7] = Buffer.from([0xff, 0xfe]);
    expect(flags(blob)).toEqual([1, 1, 0, 1, 1, 1, 1, 1, 1, 0]);

    const position = [...pristine]; position[9] = 1n;
    expect(flags(position)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 0]);

    const clock = [...pristine]; clock[15] = 1_700_000_100_001n; clock[16] = 1_700_000_100_002n;
    expect(flags(clock)).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);

    const catalog = [...pristine]; catalog[12] = "0".repeat(64);
    expect(flags(catalog)).toEqual([1, 1, 1, 1, 1, 0, 1, 1, 1, 0]);

    const shape = [...pristine]; shape[8] = "64";
    expect(flags(shape)).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 0]);

    const event = [...pristine];
    event[14] = Buffer.from('{"exists":true,"recordHash":null,"sequence":-1}');
    expect(flags(event)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 1, 0]);

    const checkpoint = physical("checkpoint");
    expect(inspectSQLiteCursorRow(checkpoint, {
      ...context, checkpointPutExists: () => false,
    }).stageValues.slice(20)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);

    const scopeLexical = [...pristine];
    scopeLexical[5] = "!invalid";
    scopeLexical[7] = Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"streamId":"!invalid"}');
    expect(flags(scopeLexical)).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 1, 0]);

    const wrongStorage = [...pristine]; wrongStorage[8] = "64";
    expect(flags(wrongStorage)).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 0]);
    const tailHashStorage = [...pristine]; tailHashStorage[11] = 7n;
    expect(flags(tailHashStorage)).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 0]);

    const unsafePage = [...pristine]; unsafePage[8] = 9_007_199_254_740_992n;
    expect(flags(unsafePage)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 0]);
    const unsafeTail = [...pristine]; unsafeTail[10] = 9_007_199_254_740_992n;
    expect(flags(unsafeTail)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 0]);
    const missingEventTail = [...pristine]; missingEventTail[10] = null;
    expect(flags(missingEventTail)).toEqual([1, 1, 1, 0, 1, 1, 1, 1, 1, 0]);
    const unownedStorageShape = [...pristine]; unownedStorageShape[12] = Buffer.alloc(32);
    expect(flags(unownedStorageShape)).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 1, 0]);
    const unsafeClock = [...pristine];
    unsafeClock[15] = 9_007_199_254_740_992n;
    unsafeClock[16] = 9_007_199_254_740_993n;
    expect(flags(unsafeClock)).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);
    const negativeClock = [...pristine]; negativeClock[15] = -1n;
    expect(flags(negativeClock)).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 0]);
  });

  it("never retains either raw blob or decoded snapshot in its result", () => {
    const inspected = inspectSQLiteCursorRow(physical("eventEmpty"), context);
    expect(Reflect.ownKeys(inspected)).toEqual([
      "preStageAuthorization", "preStageShape", "sealRow", "stageValues", "stageable",
    ]);
    expect(inspected.stageValues).toHaveLength(30);
    expect(inspected.stageValues.some((value) => Buffer.isBuffer(value))).toBe(false);
    expect(Object.isFrozen(inspected)).toBe(true);
    expect(Object.isFrozen(inspected.stageValues)).toBe(true);
  });

  it("bounds hostile TEXT identities and gives every source ordinal a unique stage key", () => {
    const first = physical("eventEmpty");
    first[0] = "x".repeat(100_000);
    first[1] = "y".repeat(100_000);
    const second = [...first];
    const a = inspectSQLiteCursorRow(first, { ...context, sourceOrdinal: 1 });
    const b = inspectSQLiteCursorRow(second, { ...context, sourceOrdinal: 2 });
    expect(a.stageable).toBe(true);
    expect(b.stageable).toBe(true);
    expect(a.stageValues[0]).toBe("!ge-invalid-token-1");
    expect(b.stageValues[0]).toBe("!ge-invalid-token-2");
    expect(String(a.stageValues[0]).length).toBeLessThan(100);
    expect(String(a.stageValues[1]).length).toBeLessThan(100);
    expect([a.stageValues[0], a.stageValues[1]]).not.toEqual([
      b.stageValues[0], b.stageValues[1],
    ]);
    expect(a.stageValues.slice(20)).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid source ordinal %s", (sourceOrdinal) => {
    expect(() => inspectSQLiteCursorRow(physical("eventEmpty"), {
      ...context, sourceOrdinal,
    })).toThrow("cursor source ordinal is invalid");
  });

  it("reports explicit rule-1/rule-8 evidence for every nonstageable key or arity", () => {
    const badTenantStorage = physical("eventEmpty");
    badTenantStorage[0] = 7n;
    const badTokenStorage = physical("eventEmpty");
    badTokenStorage[1] = Buffer.alloc(32);
    const wrongArity = physical("eventEmpty").slice(0, 17);
    for (const row of [badTenantStorage, badTokenStorage]) {
      const inspected = inspectSQLiteCursorRow(row, context);
      expect(inspected.stageable).toBe(false);
      expect(inspected.preStageAuthorization).toBe(true);
      expect(inspected.preStageShape).toBe(true);
      expect(inspected.stageValues.slice(20)).toEqual([
        1, 1, 1, 1, 1, 1, 0, 1, 1, 0,
      ]);
    }
    const arityInspection = inspectSQLiteCursorRow(wrongArity, context);
    expect(arityInspection.stageable).toBe(false);
    expect(arityInspection.preStageAuthorization).toBe(false);
    expect(arityInspection.preStageShape).toBe(true);
    expect(arityInspection.stageValues.slice(20)).toEqual([
      1, 1, 1, 1, 1, 1, 0, 1, 1, 0,
    ]);
  });

  it("keeps historical binding independent from authorization and scope rules", () => {
    const authorizationEvent = physical("eventNonempty");
    authorizationEvent[3] = "bad";
    expect(inspectSQLiteCursorRow(authorizationEvent, {
      ...context, eventTailExists: () => false,
    }).stageValues.slice(20)).toEqual([0, 1, 1, 1, 1, 1, 1, 0, 1, 0]);

    const scopeEvent = physical("eventNonempty");
    scopeEvent[6] = "other-scope";
    expect(inspectSQLiteCursorRow(scopeEvent, {
      ...context, eventTailExists: () => false,
    }).stageValues.slice(20)).toEqual([1, 0, 1, 1, 1, 1, 1, 0, 1, 0]);

    const scopeCheckpoint = physical("checkpoint");
    scopeCheckpoint[5] = "other-stream";
    expect(inspectSQLiteCursorRow(scopeCheckpoint, {
      ...context, checkpointPutExists: () => false,
    }).stageValues.slice(20)).toEqual([1, 0, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it.each([
    {
      name: "authorization plus TEXT page",
      literal: "eventEmpty",
      mutate: (row: unknown[]) => { row[3] = "bad"; row[8] = "1"; },
      inspect: (row: unknown[]) => inspectSQLiteCursorRow(row, context),
      vector: [0, 1, 1, 1, 1, 1, 0, 1, 1, 0],
    },
    {
      name: "checkpoint TEXT created clock plus missing put",
      literal: "checkpoint",
      mutate: (row: unknown[]) => { row[15] = "500"; },
      inspect: (row: unknown[]) => inspectSQLiteCursorRow(row, {
        ...context, checkpointPutExists: () => false,
      }),
      vector: [1, 1, 1, 1, 1, 1, 0, 1, 0, 0],
    },
    {
      name: "scope mismatch plus TEXT expiry",
      literal: "eventEmpty",
      mutate: (row: unknown[]) => { row[6] = "wrong-scope"; row[16] = "1500"; },
      inspect: (row: unknown[]) => inspectSQLiteCursorRow(row, context),
      vector: [1, 0, 1, 1, 1, 1, 0, 1, 1, 0],
    },
    {
      name: "TEXT consumed clock plus missing event tail",
      literal: "eventNonempty",
      mutate: (row: unknown[]) => { row[17] = "600"; },
      inspect: (row: unknown[]) => inspectSQLiteCursorRow(row, {
        ...context, eventTailExists: () => false,
      }),
      vector: [1, 1, 1, 1, 1, 1, 0, 0, 1, 0],
    },
  ])("preserves field-local mixed-storage evidence: $name", ({
    inspect, literal, mutate, vector,
  }) => {
    const row = physical(literal);
    mutate(row);
    const inspected = inspect(row);
    expect(inspected.stageable).toBe(true);
    expect(inspected.stageValues.slice(20)).toEqual(vector);
  });

  it("keeps kind storage independent from authorization semantics", () => {
    const row = physical("eventEmpty");
    row[2] = Buffer.from("event");
    row[3] = "bad";
    const inspected = inspectSQLiteCursorRow(row, context);
    expect(inspected.stageable).toBe(true);
    expect(inspected.stageValues.slice(20)).toEqual([
      0, 1, 1, 1, 1, 1, 0, 1, 1, 0,
    ]);
  });

  it("pads a short nonstageable row with SQLite NULL semantics", () => {
    const inspected = inspectSQLiteCursorRow(physical("eventEmpty").slice(0, 17), context);
    expect(inspected.stageable).toBe(false);
    expect(inspected.stageValues[17]).toBeNull();
    expect(inspected.stageValues.slice(20)).toEqual([
      1, 1, 1, 1, 1, 1, 0, 1, 1, 0,
    ]);
  });

  it("pads every nullable carrier field on a shorter row", () => {
    const inspected = inspectSQLiteCursorRow(physical("eventEmpty").slice(0, 2), context);
    expect(inspected.stageable).toBe(false);
    expect(inspected.stageValues).toHaveLength(30);
    expect([
      inspected.stageValues[5], inspected.stageValues[6],
      inspected.stageValues[11], inspected.stageValues[12], inspected.stageValues[17],
    ]).toEqual([null, null, null, null, null]);
    expect(inspected.stageValues.slice(20)).toEqual([
      1, 1, 1, 1, 1, 1, 0, 1, 1, 0,
    ]);
  });

  it("rejects a missing retained event tail", () => {
    const row = physical("eventNonempty");
    expect(inspectSQLiteCursorRow(row, {
      ...context, eventTailExists: () => false,
    }).stageValues.slice(20)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 1, 0]);
  });

  it("rejects a missing historical checkpoint put", () => {
    const row = physical("checkpoint");
    expect(inspectSQLiteCursorRow(row, {
      ...context, checkpointPutExists: () => false,
    }).stageValues.slice(20)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it("assigns scope-null-group exclusively to the closed scope rule", () => {
    const row = physical("eventEmpty");
    row[5] = null;
    expect(inspectSQLiteCursorRow(row, context).stageValues.slice(20)).toEqual([
      1, 0, 1, 1, 1, 1, 1, 1, 1, 0,
    ]);
  });

  it.each([
    {
      name: "blob-bom",
      mutate: (row: unknown[]) => { row[7] = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), row[7] as Buffer]); },
      vector: [1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "blob-duplicate-key",
      mutate: (row: unknown[]) => {
        row[7] = Buffer.from('{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":64,"pageSize":64,"streamId":"stream-alpha"}');
      },
      vector: [1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "blob-noncanonical-order",
      mutate: (row: unknown[]) => {
        row[7] = Buffer.from('{"streamId":"stream-alpha","pageSize":64,"contractVersion":"cycle-store-provider/v1alpha1"}');
      },
      vector: [1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "blob-over-bound",
      mutate: (row: unknown[]) => { row[7] = Buffer.alloc(1_048_577, 0x20); },
      vector: [1, 1, 0, 1, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "page-zero",
      mutate: (row: unknown[]) => { row[8] = 0n; },
      vector: [1, 1, 1, 0, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "page-257",
      mutate: (row: unknown[]) => { row[8] = 257n; },
      vector: [1, 1, 1, 0, 1, 1, 1, 1, 1, 0],
    },
    {
      name: "clock-consumed-before-created",
      mutate: (row: unknown[]) => { row[17] = (row[15] as bigint) - 1n; },
      vector: [1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
    },
    {
      name: "schema-substitution",
      mutate: (row: unknown[]) => { row[13] = "0".repeat(64); },
      vector: [1, 1, 1, 1, 1, 0, 1, 1, 1, 0],
    },
  ].map((testCase) => [
    `executes hostile obligation ${testCase.name}`, testCase,
  ] as const))("%s", (_title, { mutate, vector }) => {
    const row = physical("eventEmpty");
    mutate(row);
    expect(flags(row)).toEqual(vector);
  });

  it.each([
    { name: "checkpoint-sequence-order", first: { boundSequence: 5 }, second: { boundSequence: 6 } },
    {
      name: "checkpoint-created-order",
      first: { boundSequence: 6, createdAt: "2026-07-28T00:00:00Z" },
      second: { boundSequence: 6, createdAt: "2026-07-28T00:00:01Z" },
    },
    {
      name: "checkpoint-id-order",
      first: { boundSequence: 6, createdAt: "2026-07-28T00:00:00Z", checkpointId: "cp-b" },
      second: { boundSequence: 6, createdAt: "2026-07-28T00:00:00Z", checkpointId: "cp-a" },
    },
  ].map((testCase) => [
    `executes hostile obligation ${testCase.name}`, testCase,
  ] as const))("%s", (_title, { first, second }) => {
    const row = physical("checkpoint");
    const base = (JSON.parse((row[14] as Buffer).toString("utf8")) as unknown[])[0] as
      Record<string, unknown>;
    row[14] = Buffer.from(canonicalSerialize([
      { ...base, ...first },
      { ...base, checkpointId: "cp-z", ...second },
    ]));
    let lookups = 0;
    expect(inspectSQLiteCursorRow(row, {
      ...context,
      checkpointPutExists: () => { lookups += 1; return true; },
    }).stageValues.slice(20)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 0, 0,
    ]);
    expect(lookups).toBe(1);
  });
});
