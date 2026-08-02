import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";

import {
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
} from "../src/cursor-publication-rebind-contract.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic,
  prepareSQLiteCursorPublicationRebindContextIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorPublicationSession,
} from "../src/cursor-publication-outer-authority.js";
import {
  SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC,
  SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC,
  evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic,
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  executeSQLiteCursorRebindRule11GateIntrinsic,
  injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic,
  injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
  readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic,
  type SQLiteCursorRebindRule11FiveCounts,
} from "../src/cursor-publication-rebind.js";
import {
  assertSQLiteCursorPreRebindReceiptProvenance,
} from "../src/operation-baseline-cursor-ownership.js";
import {
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
} from "../src/operation-baseline-cursor-invariants.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

function graph(cursorCount = 0): ReaderLeaseTestGraph {
  const value = createReaderLeaseTestGraph(1, { cursorCount });
  graphs.push(value);
  return value;
}

function publicationSession(value: ReaderLeaseTestGraph): SQLiteCursorPublicationSession {
  const reader = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
  );
  const entries = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
  );
  const header = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
    entries,
  );
  const sequence = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
    entries,
    header,
  );
  const bundle = Object.freeze([
    value.migration0002Receipt,
    entries,
    header,
    sequence,
  ] as const satisfies SQLiteCursorInitialPublicationReceiptBundle);
  const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    value.authority,
    bundle,
    value.fence,
    reader,
  );
  const prepared = prepareSQLiteCursorPublicationSessionIntrinsic(value.authority, adoption);
  const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(prepared);
  return publishSQLiteCursorPublicationSessionIntrinsic(prepared, evidence);
}

function counts(value: number): SQLiteCursorRebindRule11FiveCounts {
  return Object.freeze({
    b2CursorCount: value,
    nativeAffectedCount: value,
    changesAffectedCount: value,
    totalChangesDelta: value,
    cursorLedgerAffectedDelta: value,
  });
}

interface TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function trackDroppedScenario(
  scenario: "success" | "prewrite-cancel" | "postconsume-poison"
    | "write-fault" | "rule11-fault",
): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const value = createReaderLeaseTestGraph(1);
  const session = publicationSession(value);
  let identities: readonly (readonly [string, object])[];
  if (scenario === "prewrite-cancel") {
    const sessionSnapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(
      sessionSnapshot.connection,
    );
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(session, execution);
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      context,
      contextSnapshot.preparedOwner,
    );
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["execution", execution],
    ];
  } else if (scenario === "success" || scenario === "postconsume-poison") {
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", rule.preparedOwner],
      ["context", rule.context],
      ["tombstone", rule.consumedTombstone],
      ["adoption", rule.watermarkAdoption],
      ["execution", write.execution],
      ["write", rule.writeReceipt],
      ["rule11", rule11],
    ];
    if (scenario === "postconsume-poison") {
      poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
        rule.context,
        rule.consumedTombstone,
        rule.watermarkAdoption,
        "GC post-consume poison",
      );
    }
  } else {
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic(
      scenario === "write-fault" ? "write" : "rule11",
      Object.freeze({ scenario }),
    );
    let failed = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`expected ${scenario} registration failure`);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["tombstone", authority.publicationSessionConsumedTombstone!],
      ["adoption", authority.postRebindWatermarkAdoption!],
      ["execution", contextSnapshot.execution],
    ];
  }
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const referents = identities.map(([label, identity]) => {
    const qualified = `${scenario}:${label}`;
    registry.register(identity, qualified);
    return { label: qualified, reference: new WeakRef(identity) };
  });
  disposeReaderLeaseTestGraph(value);
  return { finalized, referents, registry };
}

async function forceBoundedCollection(
  referents: readonly TrackedReferent[],
): Promise<readonly string[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 8 }, () => new Uint8Array(2 * 1024 * 1024));
    pressure[round % pressure.length]![0] = round;
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const live = referents.filter(({ reference }) => reference.deref() !== undefined);
    if (live.length === 0) return [];
  }
  return referents
    .filter(({ reference }) => reference.deref() !== undefined)
    .map(({ label }) => label);
}

afterEach(() => {
  for (const value of graphs.splice(0)) disposeReaderLeaseTestGraph(value);
});

describe("SQLite cursor publication rebind Rule 11 integration", () => {
  it("evaluates exactly five explicit counts under hostile iterator mutation", () => {
    for (const value of [0, 1, 7, Number.MAX_SAFE_INTEGER]) {
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts(value))).toEqual({
        accepted: true,
        counts: counts(value),
        violationCount: 0,
        diagnosticsTruncated: false,
      });
    }
    const candidates: Array<keyof SQLiteCursorRebindRule11FiveCounts> = [
      "b2CursorCount",
      "nativeAffectedCount",
      "changesAffectedCount",
      "totalChangesDelta",
      "cursorLedgerAffectedDelta",
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const key = candidates[index]!;
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic({
        ...counts(7),
        [key]: 6,
      })).toMatchObject({ accepted: false, violationCount: 1 });
    }
    const original = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function* (): Generator<never> {
      return undefined;
    };
    try {
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts(3)))
        .toMatchObject({ accepted: true, violationCount: 0 });
    } finally {
      Array.prototype[Symbol.iterator] = original;
    }
    expect(() => evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(
      new Proxy(counts(0), {}),
    )).toThrow(/count tuple is invalid/u);
    expect(() => evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic({
      ...counts(0),
      extra: 0,
    } as SQLiteCursorRebindRule11FiveCounts)).toThrow(/count tuple is invalid/u);
  });

  it.each([0, 1, 3])(
    "runs the authentic S-P-T-E-A-W-R11 chain for %i real cursors and retains exact ledgers",
    (cursorCount) => {
      const value = graph(cursorCount);
      const session = publicationSession(value);
      const sessionSnapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
      const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
      const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
      const sealReceipt = assertSQLiteCursorPreRebindReceiptProvenance(
        value.preRebindReceipt,
      ).sealReceipt;

      expect(rule).toMatchObject({
        lifecycle: "active",
        ruleId: SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC,
        position: SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC,
        violationCount: 0,
        diagnosticsTruncated: false,
      });
      expect(write).toMatchObject({
        lifecycle: "rule11-complete",
        session,
        outerAuthority: value.authority,
        connection: value.connection,
        prepareCount: 1,
        executeCount: 1,
        releaseCount: 1,
        changesPrepareCount: 1,
        changesFetchCount: 1,
        changesReleaseCount: 1,
        sql: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
        sqlSha256: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
        parameterOrder: SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
        parameterSha256: "524ece2b423a16fe16cf147e4918f74029ec71bd1559a65a2e7e2710a73ef37f",
        changesSql: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
        changesSqlSha256: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
        cursorLedgerBefore: {
          logicalWriteSequence: 0,
          fixedStatementCount: 0,
          affectedRowsWatermark: 0,
        },
        cursorLedgerAfter: {
          logicalWriteSequence: 1,
          fixedStatementCount: 1,
          affectedRowsWatermark: cursorCount,
        },
        counts: counts(cursorCount),
        violationCount: 0,
      });
      expect(sealReceipt.cursorCount).toBe(cursorCount);
      if (cursorCount > 0) {
        expect(sealReceipt.immutableRootSha256).not.toBe(SQLITE_CURSOR_SEAL_EMPTY_ROOT);
      }
      expect(write.preparedExecutionSnapshot.lifecycle).toBe("active");
      expect(write.completedExecutionSnapshot.lifecycle).toBe("completed");
      expect(write.outerLedgerAfter).toEqual(write.outerLedgerBefore);
      expect(write.transactionEpochAfter).toBe(write.transactionEpochBefore + 1n);
      expect(BigInt(write.totalChangesAfter)).toBe(
        BigInt(write.totalChangesBefore) + BigInt(cursorCount),
      );
      expect(rule.transactionEpoch).toBe(write.transactionEpochAfter);
      expect(rule.totalChanges).toBe(write.totalChangesAfter);
      expect(value.connection.prepare(
        "SELECT DISTINCT descriptor_hash, schema_identity_sha256 "
          + "FROM main.ge_cycle_cursors ORDER BY descriptor_hash, schema_identity_sha256",
        "inspect-schema",
      ).all()).toEqual(cursorCount === 0 ? [] : [[
        sessionSnapshot.targetDescriptorHash,
        sessionSnapshot.targetSchemaIdentitySha256,
      ]]);
      expect(Object.isFrozen(write)).toBe(true);
      expect(Object.isFrozen(rule)).toBe(true);

      expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
        Object.freeze(Object.create(null)),
      )).toThrow(/Rule 11 owner is invalid/u);
      expect(() => readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
        new Proxy(rule.writeReceipt, {}),
      )).toThrow(/write receipt is invalid/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
        .toBe("active");
      expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rule.writeReceipt))
        .toThrow(/write receipt is terminal/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
        .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    },
  );

  it("rejects forged W/R11 presentations and poisons only the exact replay-selected run", () => {
    const left = graph();
    const right = graph();
    const leftRule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(
      publicationSession(left),
    );
    const rightRule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(
      publicationSession(right),
    );
    const leftRule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(leftRule11);
    const rightRule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rightRule11);
    const leftWriteProjection = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
      leftRule.writeReceipt,
    );

    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(
      Object.freeze({ ...leftWriteProjection }),
    )).toThrow(/write receipt is invalid/u);
    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(
      new Proxy(leftRule.writeReceipt, {}),
    )).toThrow(/write receipt is invalid/u);
    expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
      Object.freeze({ ...leftRule }),
    )).toThrow(/Rule 11 owner is invalid/u);
    expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
      new Proxy(leftRule11, {}),
    )).toThrow(/Rule 11 owner is invalid/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority).lifecycle)
      .toBe("active");

    // The exact W selects its own run. Replaying right W poisons right only;
    // structurally equal/cross-run projections never select left.
    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rightRule.writeReceipt))
      .toThrow(/write receipt is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority).lifecycle)
      .toBe("poisoned");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(leftRule11)).toEqual(leftRule);
  });

  it("cancels after authenticating but without consuming S, then retries", () => {
    const value = graph();
    const session = publicationSession(value);
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    controller.cancel();
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrowError(CycleStoreProviderError);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).writePhase)
      .toBe("publication-active");
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("authenticates forged or drifted S before honoring an already-cancelled signal", () => {
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    controller.cancel();

    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      Object.freeze(Object.create(null)) as unknown as SQLiteCursorPublicationSession,
      controller.signal,
    )).toThrow(/publication session is invalid/u);

    const value = graph();
    const session = publicationSession(value);
    value.connection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("hostile-owner-before-cancelled-entry");
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrowError(expect.not.objectContaining({
      message: expect.stringContaining("cancelled before prepare"),
    }));
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("releases P/context before consume on second-boundary cancellation and retries S", () => {
    const value = graph();
    const session = publicationSession(value);
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic();
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrow(/cancelled before execute/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("cleans an unbound E after outer context registration failure and retries S", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "context-session-registration" });
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "context-session",
      primary,
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected context registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("releases prepared E/context after T registration failure and permits fresh retry", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "session-tombstone-registration" });
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "session-tombstone",
      primary,
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected T registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("preserves an A registration primary and poisons after T consumption", () => {
    const value = graph();
    const session = publicationSession(value);
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "watermark-adoption",
      undefined,
    );
    let caught = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons exact outer graph on W registration failure and preserves thrown undefined", () => {
    const value = graph();
    const session = publicationSession(value);
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic("write", undefined);
    let caught = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons exact outer graph on R11 registration failure without replacing primary", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "rule11-registration" });
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic("rule11", primary);
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("performs zero additional SQLite work while reading W/R11 retained proofs", () => {
    const value = graph();
    const session = publicationSession(value);
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    const before = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
    const prepare = value.connection.prepare;
    let prepareCount = 0;
    const connectionReads = {
      isTransaction: 0,
      transactionEpoch: 0,
      transactionLineage: 0,
      transactionMode: 0,
    };
    const connectionValues = {
      isTransaction: value.connection.isTransaction,
      transactionEpoch: value.connection.transactionEpoch,
      transactionLineage: value.connection.transactionLineage,
      transactionMode: value.connection.transactionMode,
    };
    value.connection.prepare = function (...args: Parameters<typeof prepare>) {
      prepareCount += 1;
      return Reflect.apply(prepare, this, args) as ReturnType<typeof prepare>;
    };
    Object.defineProperties(value.connection, {
      isTransaction: {
        configurable: true,
        get() {
          connectionReads.isTransaction += 1;
          return connectionValues.isTransaction;
        },
      },
      transactionEpoch: {
        configurable: true,
        get() {
          connectionReads.transactionEpoch += 1;
          return connectionValues.transactionEpoch;
        },
      },
      transactionLineage: {
        configurable: true,
        get() {
          connectionReads.transactionLineage += 1;
          return connectionValues.transactionLineage;
        },
      },
      transactionMode: {
        configurable: true,
        get() {
          connectionReads.transactionMode += 1;
          return connectionValues.transactionMode;
        },
      },
    });
    try {
      expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11)).toEqual(rule);
      expect(readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt)).toEqual(before);
      expect(prepareCount).toBe(0);
      expect(connectionReads).toEqual({
        isTransaction: 0,
        transactionEpoch: 0,
        transactionLineage: 0,
        transactionMode: 0,
      });

      // A terminal replay still traverses the real gate's retained graph
      // authentication before it rejects.  Dynamically surround that gate,
      // not only the public snapshot readers, to prove it performs no public
      // SQL/transaction/clock observation on the retained-only path.
      expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rule.writeReceipt))
        .toThrow(/write receipt is terminal/u);
      expect(prepareCount).toBe(0);
      expect(connectionReads).toEqual({
        isTransaction: 0,
        transactionEpoch: 0,
        transactionLineage: 0,
        transactionMode: 0,
      });

      const protocolSource = readFileSync(
        new URL("../src/cursor-publication-rebind.ts", import.meta.url),
        "utf8",
      );
      const outerSource = readFileSync(
        new URL("../src/cursor-publication-outer-authority.ts", import.meta.url),
        "utf8",
      );
      const retainedStart = protocolSource.indexOf("function assertWriteRetainedGraph");
      const retainedEnd = protocolSource.indexOf("\nfunction mintWriteReceipt", retainedStart);
      const retainedClosure = protocolSource.slice(retainedStart, retainedEnd);
      const adoptionStart = outerSource.indexOf(
        "export function assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic",
      );
      const adoptionEnd = outerSource.indexOf("\nexport function ", adoptionStart + 1);
      const adoptionClosure = outerSource.slice(adoptionStart, adoptionEnd);
      for (const closure of [retainedClosure, adoptionClosure]) {
        expect(closure).not.toContain("readSQLiteConnectionOwnerSnapshot(");
        expect(closure).not.toContain("readSQLiteConnectionTotalChangesSnapshot(");
        expect(closure).not.toContain(
          "readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(",
        );
        expect(closure).not.toContain(
          "readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(",
        );
        expect(closure).not.toContain("assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(");
        expect(closure).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
      }
    } finally {
      value.connection.prepare = prepare;
      for (const name of [
        "isTransaction",
        "transactionEpoch",
        "transactionLineage",
        "transactionMode",
      ]) {
        Reflect.deleteProperty(value.connection, name);
      }
    }
  });

  it("does not export the private protocol module or capabilities from the package root", () => {
    for (const name of [
      "executeSQLiteCursorPublicationRebindRule11Intrinsic",
      "executeSQLiteCursorRebindRule11GateIntrinsic",
      "SQLiteCursorRebindWriteReceipt",
      "SQLiteCursorRebindRule11Owner",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toContain("cursor-publication-rebind");
    expect(source).not.toContain("SQLiteCursorRebindWriteReceipt");
    expect(source).not.toContain("SQLiteCursorRebindRule11Owner");
  });

  if (process.env.GRAPH_ENGINEERING_RUN_RULE11_GC_PROBE !== "1") {
    it("passes success, cancellation, poison and W/R11-fault isolated GC", () => {
      const packageRoot = fileURLToPath(new URL("..", import.meta.url));
      const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          vitest,
          "run",
          "test/cursor-publication-rebind-rule11.test.ts",
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
          "--reporter=dot",
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: { ...process.env, GRAPH_ENGINEERING_RUN_RULE11_GC_PROBE: "1" },
          timeout: 150_000,
        },
      );
      expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
      expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
      expect(result.status, [
        "isolated Rule 11 GC probe failed",
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join("\n")).toBe(0);
    }, 160_000);
  } else {
    it("collects every exact identity in all five terminal profiles", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const scenarios = [
        "success",
        "prewrite-cancel",
        "postconsume-poison",
        "write-fault",
        "rule11-fault",
      ] as const;
      for (let index = 0; index < scenarios.length; index += 1) {
        const tracked = trackDroppedScenario(scenarios[index]!);
        const live = await forceBoundedCollection(tracked.referents);
        expect(live, [
          `Rule 11 ${scenarios[index]} graph retained strong roots after 80 GC rounds`,
          `live=${live.join(",") || "none"}`,
          `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
        ].join("; ")).toEqual([]);
        expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
      }
    }, 120_000);
  }
});
