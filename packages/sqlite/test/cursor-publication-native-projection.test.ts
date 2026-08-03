import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import { cycleStoreAdapterCodec } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES,
  acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic,
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic,
  assertSQLiteCursorPublicationNativeMutationParentIntrinsic,
  boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic,
  captureSQLiteCursorPublicationNativeProjectionIntrinsic,
  consumeSQLiteCursorPublicationMutationChildPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationParentScopeIntrinsic,
  enterSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationMutationParentScopeIntrinsic,
  injectSQLiteCursorPublicationNativeProjectionCompositionFaultForTestIntrinsic,
  mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic,
  prepareSQLiteCursorPublicationReusableParentIntrinsic,
  readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic,
  recordSQLiteCursorPublicationMutationChildReturnIntrinsic,
  retireSQLiteCursorPublicationMutationChildResourceIntrinsic,
  retireSQLiteCursorPublicationReusableParentResourceIntrinsic,
  type SQLiteCursorPublicationMutationParentScope,
  type SQLiteCursorPublicationOwnerComposition,
} from "../src/cursor-publication-owner-composition.js";
import {
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
  type SQLiteCursorPublicationTransactionBeginReceipt,
  type SQLiteCursorPublicationTransactionOwner,
} from "../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  injectSQLiteV1BaselineNativeProjectionFaultForTestIntrinsic,
  injectSQLiteV1BaselineNativeProjectionFaultSequenceForTestIntrinsic,
  readSQLiteV1BaselineNativeProjectionFailureTelemetryForTestIntrinsic,
  sqliteV1BaselineNormalizedSqlSha256Intrinsic,
  type SQLiteV1BaselineNativeProjectionFaultPoint,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import {
  createSQLiteCursorNativeProjectionNormalizedReport,
  normalizeSQLiteCursorNativeProjectionRejectionCase,
  normalizeSQLiteCursorNativeProjectionSuccessCase,
} from "./support/cursor-publication-native-projection-normalized-report.js";

const APPLIED_AT_MS = 1_785_110_405_000;
const roots: string[] = [];
const graphs: NativeGraph[] = [];
const NP1_FAMILY_ORDER = [
  "schema-envelope",
  "migration-lineage",
  "stream-head",
  "record-identity",
  "checkpoint-current",
  "checkpoint-revision",
  "lease-current",
  "used-lease-identity",
  "legal-hold",
  "migration-lock-current",
  "used-migration-lock-identity",
  "legacy-operation",
] as const;
const NP1_FRESH_FAMILY_COUNTS = new Map(NP1_FAMILY_ORDER.map((family) => [
  family,
  family === "schema-envelope" || family === "migration-lineage"
    || family === "migration-lock-current" ? 1 : 0,
] as const));
const NP1_FAMILY_BOUNDARY_FAULTS = NP1_FAMILY_ORDER.flatMap((family) => {
  const observedCount = NP1_FRESH_FAMILY_COUNTS.get(family)!;
  return ([
    "prepare-before",
    "prepare-after",
    "next-before",
    "next-after",
    "terminal-before",
    "terminal-after",
    "retirement-reproof-before",
    "return",
    "retirement-reproof-after",
  ] as const).map((point) => ({
    family,
    optionalRows: 0 as const,
    point,
    rowOrdinal: point.startsWith("terminal") || point.includes("return")
      || point.startsWith("retirement") ? observedCount : 0,
  }));
});
const NP1_ROW_BOUNDARY_FAULTS = [
  ...(["schema-envelope", "migration-lineage", "migration-lock-current"] as const)
    .flatMap((family) => (["decode-before", "decode-after"] as const).map((point) => ({
      family,
      optionalRows: 0 as const,
      point,
      rowOrdinal: 0,
    }))),
  ...([0, 1, 2] as const).flatMap((rowOrdinal) =>
    (["next-before", "next-after", "decode-before", "decode-after"] as const)
      .map((point) => ({
        family: "legacy-operation" as const,
        optionalRows: 3 as const,
        point,
        rowOrdinal,
      }))),
] as const;
const NP1_TERMINAL_STEP_FAULTS = NP1_FAMILY_ORDER.flatMap((family) => {
  const optionalRows = family === "legacy-operation" ? 3 as const : 0 as const;
  const rowOrdinal = family === "legacy-operation"
    ? 3
    : NP1_FRESH_FAMILY_COUNTS.get(family)!;
  return (["next-before", "next-after"] as const).map((point) => ({
    family,
    optionalRows,
    point,
    rowOrdinal,
  }));
});
const NP1_EXHAUSTIVE_FAULT_CASES = [
  ...NP1_FAMILY_BOUNDARY_FAULTS,
  ...NP1_ROW_BOUNDARY_FAULTS,
  ...NP1_TERMINAL_STEP_FAULTS,
] as const;

interface NativeGraph {
  readonly root: string;
  readonly connection: SQLiteConnection;
  readonly owner: SQLiteCursorPublicationTransactionOwner;
  readonly beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly composition: SQLiteCursorPublicationOwnerComposition;
}

function seedLegacyOperations(connection: SQLiteConnection, count: number): void {
  const result = { deleted: false } as const;
  const blob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("delete-checkpoint", result),
  );
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    connection.prepare(`
      INSERT INTO ge_cycle_operations
        (tenant_id, operation_id, operation_name, request_hash,
         result_blob, result_hash, committed_at_ms)
      VALUES (?, ?, 'delete-checkpoint', ?, ?, ?, ?)
    `, "inspect-schema").run(
      "tenant-a",
      `operation-${ordinal}`,
      createHash("sha256").update(`request-${ordinal}`).digest("hex"),
      blob,
      canonicalHash(result),
      APPLIED_AT_MS,
    );
  }
}

function nativeGraph(optionalLegacyRows: number): NativeGraph {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-native-projection-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: APPLIED_AT_MS,
  });
  seedLegacyOperations(connection, optionalLegacyRows);
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const beginReceipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(owner, beginReceipt);
  const graph = { beginReceipt, composition, connection, owner, root, sourceSummary };
  graphs.push(graph);
  return graph;
}

afterEach(() => {
  for (const graph of graphs.splice(0)) {
    if (readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner).lifecycle
        === "active") {
      const primary = new Error("NP1_TEST_BOUNDED_STOP");
      expect(() => boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
        graph.composition,
        primary,
      )).toThrow(primary);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite P11-A lower-native baseline projection", () => {
  it("normalizes only the frozen ASCII SQL formatting whitespace set", () => {
    const canonical = "SELECT value FROM source";
    const expected = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(sqliteV1BaselineNormalizedSqlSha256Intrinsic(
      "\t\r\nSELECT\vvalue\fFROM\rsource \n",
    )).toBe(expected);

    for (const preserved of ["\u00a0", "\u0085", "\ufeff", "\u001c"]) {
      for (const sql of [
        `${preserved}${canonical}`,
        `${canonical}${preserved}`,
        `SELECT${preserved}value FROM source`,
      ]) {
        expect(sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql)).toBe(
          createHash("sha256").update(sql, "utf8").digest("hex"),
        );
        expect(sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql)).not.toBe(expected);
      }
    }
  });

  it.each([
    [0, 3],
    [1, 4],
    [3, 6],
  ] as const)(
    "drains all twelve file-backed families for optional N=%i into total %i",
    (optionalRows, total) => {
      const graph = nativeGraph(optionalRows);
      const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      );
      const snapshot = assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent);
      expect(snapshot).toMatchObject({
        countProvenance: "lower-native",
        exactReadSession: true,
        expectedProjectionCount: total,
        familyCount: 12,
        fullExhausted: true,
        genuineZeroClaim: false,
        lifecycle: "consumed",
        logicalNativeReadCount: 12,
        nativeProjectionAuthority: true,
        nativeSourceProvenance: true,
        retainedCount: total,
        routeId: "main.baseline-entries",
        sourceDomain: "sqlite-v1-baseline-source",
      });
      expect(snapshot.readSessionSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(snapshot.projectionSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(snapshot.familyRetirements).toHaveLength(12);
      expect(snapshot.familyRetirements.map((family) => family.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "stream-head",
        "record-identity",
        "checkpoint-current",
        "checkpoint-revision",
        "lease-current",
        "used-lease-identity",
        "legal-hold",
        "migration-lock-current",
        "used-migration-lock-identity",
        "legacy-operation",
      ]);
      for (const family of snapshot.familyRetirements) {
        expect(family).toMatchObject({
          observedCount: family.expectedCount,
          prepareCount: 1,
          retirementAttemptCount: 1,
          retirementSuccessCount: 1,
          terminalCount: 1,
          terminalObserved: true,
        });
      }
      expect(snapshot.familyRetirements.at(-1)).toMatchObject({
        entryKind: "legacy-operation",
        expectedCount: optionalRows,
        observedCount: optionalRows,
      });

      expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
        .toMatchObject({
          actualNativeIoCount: 0,
          countProvenance: "lower-native",
          expectedCount: total,
          nativeProjectionLogicalReadCount: 12,
        });
    },
  );

  it.each([0, 1])(
    "keeps generic total %i shape-only and rejects it at the native bridge",
    (count) => {
      const graph = nativeGraph(0);
      const retained = Object.freeze(Array.from(
        { length: count },
        (_, ordinal) => Object.freeze({ ordinal }),
      ));
      const generic = mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic(
        graph.composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retained,
      );
      const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        graph.composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        generic,
      );
      expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
        .toMatchObject({
          actualNativeIoCount: 0,
          countProvenance: "shape-only",
          expectedCount: count,
          nativeProjectionLogicalReadCount: 0,
        });
      expect(() => assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent))
        .toThrow();
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner).lifecycle)
        .toBe("finalized");
    },
  );

  it("uses captured native preparation even after a hostile prototype replacement", () => {
    const graph = nativeGraph(1);
    const original = SQLiteConnection.prototype.prepare;
    Object.defineProperty(SQLiteConnection.prototype, "prepare", {
      configurable: true,
      value: new Proxy(original, {
        apply() {
          throw new Error("replaceable prepare must not be reached");
        },
      }),
      writable: true,
    });
    try {
      const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      );
      expect(assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent))
        .toMatchObject({ retainedCount: 4, fullExhausted: true });
    } finally {
      Object.defineProperty(SQLiteConnection.prototype, "prepare", {
        configurable: true,
        value: original,
        writable: true,
      });
    }
  });

  it("uses captured opaque registries after hostile WeakMap substitution", () => {
    const real = nativeGraph(0);
    const forgedTarget = nativeGraph(0);
    const forged = Object.freeze({ ...real.sourceSummary }) as SQLiteV1BaselineSourceSummary;
    const originalGet = WeakMap.prototype.get;
    const originalSet = WeakMap.prototype.set;
    Object.defineProperties(WeakMap.prototype, {
      get: {
        configurable: true,
        value: new Proxy(originalGet, {
          apply() {
            throw new Error("replaceable WeakMap.get must not be reached");
          },
        }),
        writable: true,
      },
      set: {
        configurable: true,
        value: new Proxy(originalSet, {
          apply() {
            throw new Error("replaceable WeakMap.set must not be reached");
          },
        }),
        writable: true,
      },
    });
    let realSnapshot: unknown;
    let forgedFailure: unknown;
    try {
      const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        real.composition,
        real.sourceSummary,
      );
      realSnapshot = assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent);
      try {
        captureSQLiteCursorPublicationNativeProjectionIntrinsic(
          forgedTarget.composition,
          forged,
        );
      } catch (error) {
        forgedFailure = error;
      }
    } finally {
      Object.defineProperties(WeakMap.prototype, {
        get: { configurable: true, value: originalGet, writable: true },
        set: { configurable: true, value: originalSet, writable: true },
      });
    }
    expect(realSnapshot).toMatchObject({ retainedCount: 3 });
    expect(forgedFailure).toMatchObject({
      message: "SQLite v1 baseline lower-owned source is invalid",
    });
  });

  it("keeps every NP1 authority identity behind definition-captured builtins", () => {
    const graph = nativeGraph(1);
    const mapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Map")!;
    const setDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Set")!;
    const createDescriptor = Object.getOwnPropertyDescriptor(Object, "create")!;
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    const arrayMapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const arrayPushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
    const arrayReduceDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "reduce")!;
    const arraySliceDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "slice")!;
    const arraySomeDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
    const mapGetDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "get")!;
    const mapSetDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "set")!;
    const setAddDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "add")!;
    const setHasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has")!;
    let observedAuthority: unknown;
    let hostileCallCount = 0;
    const rejectAt = (label: string) => function(this: unknown, ...values: unknown[]): never {
      hostileCallCount += 1;
      observedAuthority = values.length === 0 ? this : values[0];
      throw new Error(`replaceable NP1 authority builtin reached: ${label}`);
    };
    class HostileMap {
      constructor(...values: unknown[]) {
        rejectAt("Map")(...values);
      }
    }
    class HostileSet {
      constructor(...values: unknown[]) {
        rejectAt("Set")(...values);
      }
    }
    Object.defineProperties(globalThis, {
      Map: { ...mapDescriptor, value: HostileMap },
      Set: { ...setDescriptor, value: HostileSet },
    });
    Object.defineProperties(Object, {
      create: { ...createDescriptor, value: rejectAt("Object.create") },
      freeze: { ...freezeDescriptor, value: rejectAt("Object.freeze") },
    });
    Object.defineProperties(Array.prototype, {
      map: { ...arrayMapDescriptor, value: rejectAt("Array.map") },
      push: { ...arrayPushDescriptor, value: rejectAt("Array.push") },
      reduce: { ...arrayReduceDescriptor, value: rejectAt("Array.reduce") },
      slice: { ...arraySliceDescriptor, value: rejectAt("Array.slice") },
      some: { ...arraySomeDescriptor, value: rejectAt("Array.some") },
    });
    Object.defineProperties(Map.prototype, {
      get: { ...mapGetDescriptor, value: rejectAt("Map.get") },
      set: { ...mapSetDescriptor, value: rejectAt("Map.set") },
    });
    Object.defineProperties(Set.prototype, {
      add: { ...setAddDescriptor, value: rejectAt("Set.add") },
      has: { ...setHasDescriptor, value: rejectAt("Set.has") },
    });
    let parent: SQLiteCursorPublicationMutationParentScope | undefined;
    try {
      parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      );
    } finally {
      Object.defineProperties(globalThis, { Map: mapDescriptor, Set: setDescriptor });
      Object.defineProperties(Object, { create: createDescriptor, freeze: freezeDescriptor });
      Object.defineProperties(Array.prototype, {
        map: arrayMapDescriptor,
        push: arrayPushDescriptor,
        reduce: arrayReduceDescriptor,
        slice: arraySliceDescriptor,
        some: arraySomeDescriptor,
      });
      Object.defineProperties(Map.prototype, {
        get: mapGetDescriptor,
        set: mapSetDescriptor,
      });
      Object.defineProperties(Set.prototype, {
        add: setAddDescriptor,
        has: setHasDescriptor,
      });
    }
    expect(hostileCallCount).toBe(0);
    expect(observedAuthority).toBeUndefined();
    expect(parent).toBeDefined();
    expect(assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent!))
      .toMatchObject({ exactResourcePairing: true, retainedCount: 4 });
  });

  it("terminalizes only the target on cross-composition projection presentation", () => {
    const foreign = nativeGraph(0);
    const target = nativeGraph(0);
    expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      target.composition,
      foreign.sourceSummary,
    )).toThrow();
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(target.owner).lifecycle)
      .toBe("finalized");
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(foreign.owner).lifecycle)
      .toBe("active");
    const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      foreign.composition,
      foreign.sourceSummary,
    );
    expect(assertSQLiteCursorPublicationNativeMutationParentIntrinsic(parent))
      .toMatchObject({ lifecycle: "consumed", retainedCount: 3 });
  });

  it("keeps the capture boundary one-shot after its first receipt", () => {
    const graph = nativeGraph(0);
    captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      graph.composition,
      graph.sourceSummary,
    );
    expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      graph.composition,
      graph.sourceSummary,
    )).toThrow();
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner).lifecycle)
      .toBe("finalized");
  });

  it("completes the exact reusable parent lifecycle for all three mandatory rows", () => {
    const graph = nativeGraph(0);
    const parent = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      graph.composition,
      graph.sourceSummary,
    );
    prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
    for (let ordinal = 0; ordinal < 3; ordinal += 1) {
      const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, ordinal);
      enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
      retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
      acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
      consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
    }
    retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
    consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toMatchObject({
        childConsumedCount: 3,
        lifecycle: "parent-consumed",
        nextOrdinal: 3,
        parentResourceRetiredCount: 1,
      });
  });

  it.each([
    "prepare-before",
    "next-after",
    "decode-before",
    "terminal-after",
    "return",
    "hash-before",
    "hash-after",
    "mint-before",
    "mint-after",
  ] satisfies readonly SQLiteV1BaselineNativeProjectionFaultPoint[])(
    "preserves the exact %s primary and performs bounded P9 cleanup",
    (point) => {
      const graph = nativeGraph(0);
      const primary = new Error(`native-${point}-primary`);
      injectSQLiteV1BaselineNativeProjectionFaultForTestIntrinsic(point, primary);
      expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      )).toThrow(primary);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          closeNativeReturnCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenAttemptCount: 1,
          reopenSourceV1Count: 1,
          rollbackAttemptCount: 1,
          rollbackNativeReturnCount: 1,
        });
    },
  );

  it.each([
    "consume-before",
    "consume-after",
    "parent-issue-before",
    "parent-issue-after",
  ] as const)(
    "preserves the exact composition %s primary before any parent escapes",
    (point) => {
      const graph = nativeGraph(0);
      const primary = new Error(`composition-${point}-primary`);
      injectSQLiteCursorPublicationNativeProjectionCompositionFaultForTestIntrinsic(
        point,
        primary,
      );
      expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      )).toThrow(primary);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenSourceV1Count: 1,
          rollbackAttemptCount: 1,
        });
      expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      )).toThrowError(/owner composition is terminal/u);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          commitAttemptCount: 0,
          reopenAttemptCount: 1,
          rollbackAttemptCount: 1,
        });
    },
  );

  it("freezes the exhaustive family/row boundary inventory", () => {
    expect(NP1_EXHAUSTIVE_FAULT_CASES).toHaveLength(150);
  });

  it.each(NP1_EXHAUSTIVE_FAULT_CASES)(
    "fails closed at $point:$family row $rowOrdinal without exposing a parent",
    ({ family, optionalRows, point, rowOrdinal }) => {
      const graph = nativeGraph(optionalRows);
      const primary = new Error(`matrix:${point}:${family}:${rowOrdinal}`);
      injectSQLiteV1BaselineNativeProjectionFaultForTestIntrinsic(
        point,
        primary,
        family,
        rowOrdinal,
      );
      let escaped: unknown;
      let failure: unknown;
      try {
        escaped = captureSQLiteCursorPublicationNativeProjectionIntrinsic(
          graph.composition,
          graph.sourceSummary,
        );
      } catch (error) {
        failure = error;
      }
      expect(escaped).toBeUndefined();
      expect(failure).toBe(primary);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenAttemptCount: 1,
          rollbackAttemptCount: 1,
        });
      const priorFamilyCount = NP1_FAMILY_ORDER.indexOf(family);
      const currentIteratorWasCreated = point !== "prepare-before"
        && point !== "prepare-after";
      const expectedAttempts = priorFamilyCount + (currentIteratorWasCreated ? 1 : 0);
      expect(readSQLiteV1BaselineNativeProjectionFailureTelemetryForTestIntrinsic())
        .toEqual({
          nativeReturnAttemptCount: expectedAttempts,
          nativeReturnSuccessCount: expectedAttempts - (point === "return" ? 1 : 0),
          secondaryFailureCount: 0,
        });
      expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        graph.composition,
        graph.sourceSummary,
      )).toThrowError(/owner composition is terminal/u);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          commitAttemptCount: 0,
          reopenAttemptCount: 1,
          rollbackAttemptCount: 1,
        });
    },
  );

  it("preserves a decode primary over a same-resource return secondary", () => {
    const graph = nativeGraph(0);
    const primary = new Error("decode-primary");
    const secondary = new Error("return-secondary");
    injectSQLiteV1BaselineNativeProjectionFaultSequenceForTestIntrinsic([
      {
        error: primary,
        family: "schema-envelope",
        point: "decode-before",
        rowOrdinal: 0,
      },
      {
        error: secondary,
        family: "schema-envelope",
        point: "return",
        rowOrdinal: 1,
      },
    ]);
    expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      graph.composition,
      graph.sourceSummary,
    )).toThrow(primary);
    expect(readSQLiteV1BaselineNativeProjectionFailureTelemetryForTestIntrinsic())
      .toEqual({
        nativeReturnAttemptCount: 1,
        nativeReturnSuccessCount: 0,
        secondaryFailureCount: 1,
      });
  });

  it.each([
    ["retirement-reproof-before", 1],
    ["retirement-reproof-after", 1],
    ["return", 0],
  ] as const)("records bounded %s retirement evidence", (point, expectedSuccesses) => {
    const graph = nativeGraph(0);
    const primary = new Error(`retirement:${point}`);
    injectSQLiteV1BaselineNativeProjectionFaultForTestIntrinsic(
      point,
      primary,
      "schema-envelope",
      1,
    );
    expect(() => captureSQLiteCursorPublicationNativeProjectionIntrinsic(
      graph.composition,
      graph.sourceSummary,
    )).toThrow(primary);
    expect(readSQLiteV1BaselineNativeProjectionFailureTelemetryForTestIntrinsic())
      .toEqual({
        nativeReturnAttemptCount: 1,
        nativeReturnSuccessCount: expectedSuccesses,
        secondaryFailureCount: 0,
      });
  });

  it("matches the independent canonical projection oracle and separates sessions", () => {
    const oracle = nativeGraph(1);
    const expectedProjectionSha256 = createHash("sha256")
      .update("graph-engineering/sqlite-v1-baseline-projection/v1\0")
      .update(canonicalSerialize([...oracle.sourceSummary.entries()]))
      .digest("hex");
    const expectedSourceSummarySha256 = canonicalHash({
      clockEvidence: oracle.sourceSummary.clockEvidence,
      countsByKind: oracle.sourceSummary.countsByKind,
      expectedEntryCount: oracle.sourceSummary.expectedEntryCount,
      sourceEnvelope: oracle.sourceSummary.sourceEnvelope,
    });

    const first = nativeGraph(1);
    const second = nativeGraph(1);
    const firstSnapshot = assertSQLiteCursorPublicationNativeMutationParentIntrinsic(
      captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        first.composition,
        first.sourceSummary,
      ),
    );
    const secondSnapshot = assertSQLiteCursorPublicationNativeMutationParentIntrinsic(
      captureSQLiteCursorPublicationNativeProjectionIntrinsic(
        second.composition,
        second.sourceSummary,
      ),
    );
    expect(firstSnapshot.projectionSha256).toBe(expectedProjectionSha256);
    expect(secondSnapshot.projectionSha256).toBe(expectedProjectionSha256);
    expect(firstSnapshot.sourceSummarySha256).toBe(expectedSourceSummarySha256);
    expect(secondSnapshot.sourceSummarySha256).toBe(expectedSourceSummarySha256);
    expect(firstSnapshot.readSessionSha256).not.toBe(secondSnapshot.readSessionSha256);
    expect(firstSnapshot.familyRetirements.map((family) => family.sqlSha256))
      .toEqual(secondSnapshot.familyRetirements.map((family) => family.sqlSha256));
  });

  it("builds the exact schema-shaped normalized success and rejection inventory", () => {
    const successes = ([0, 1, 3] as const).map((optionalCount) => {
      const graph = nativeGraph(optionalCount);
      return normalizeSQLiteCursorNativeProjectionSuccessCase(
        optionalCount,
        assertSQLiteCursorPublicationNativeMutationParentIntrinsic(
          captureSQLiteCursorPublicationNativeProjectionIntrinsic(
            graph.composition,
            graph.sourceSummary,
          ),
        ),
      );
    });
    const rejections = ([0, 1] as const).map((impossibleTotal) => {
      const graph = nativeGraph(0);
      const forged = Object.freeze({
        ...graph.sourceSummary,
        expectedEntryCount: impossibleTotal,
      }) as SQLiteV1BaselineSourceSummary;
      let rejection: unknown;
      try {
        captureSQLiteCursorPublicationNativeProjectionIntrinsic(graph.composition, forged);
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeDefined();
      return normalizeSQLiteCursorNativeProjectionRejectionCase(
        impossibleTotal,
        rejection,
        readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner),
      );
    });
    const report = createSQLiteCursorNativeProjectionNormalizedReport(
      successes,
      rejections,
    );
    expect(report).toMatchObject({
      contractId: "sqlite-cursor-publication-native-projection-np1/v1",
      implementation: "typescript",
      schemaVersion: 1,
      portable: {
        invariants: {
          completeProjectionCounts: [3, 4, 6],
          mandatorySingletonCount: 3,
          optionalDynamicCounts: [0, 1, 3],
        },
        rejectionCases: [
          { caseId: "baseline-total-0-impossible", logicalNativeReadCount: 0 },
          { caseId: "baseline-total-1-impossible", logicalNativeReadCount: 0 },
        ],
        successCases: [
          { caseId: "baseline-dynamic-0-total-3", retainedProjectionCount: 3 },
          { caseId: "baseline-dynamic-1-total-4", retainedProjectionCount: 4 },
          { caseId: "baseline-dynamic-3-total-6", retainedProjectionCount: 6 },
        ],
      },
      runtimeLocal: {
        retirementMechanism: "native-iterator-return",
        runtime: "typescript",
      },
    });
  });
});
