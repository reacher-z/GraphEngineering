import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  injectSQLiteCursorThirdRegistrationFaultForTestIntrinsic,
  observeSQLiteCursorBeforeVerificationClockIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
  readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic,
  readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic,
} from "../src/cursor-publication-clock-authority.js";
import {
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  injectSQLiteCursorRule12SealAdoptionFaultForTestIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
} from "../src/cursor-publication-outer-authority.js";
import {
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
} from "../src/cursor-publication-rebind.js";
import {
  SQLITE_CURSOR_RULE12_ID_INTRINSIC,
  SQLITE_CURSOR_RULE12_ORDER_INTRINSIC,
  SQLITE_CURSOR_RULE12_POSITION_INTRINSIC,
  executeSQLiteCursorPublicationRule12Intrinsic,
  injectSQLiteCursorRule12CleanupFaultForTestIntrinsic,
  injectSQLiteCursorRule12PostRegistrationFailureObserverForTestIntrinsic,
  injectSQLiteCursorRule12PostSealValidationObserverForTestIntrinsic,
  injectSQLiteCursorRule12RegistrationFaultForTestIntrinsic,
  readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic,
  type SQLiteCursorRule12SuccessReceipt,
} from "../src/cursor-publication-rule12.js";
import { assertSQLiteCursorPreRebindReceiptProvenance } from
  "../src/operation-baseline-cursor-ownership.js";
import {
  readSQLiteConnectionPostRebindSealQueryPlansIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  publishReaderLeaseTestGraphSession,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

function graph(cursorCount = 0, providerClockNow?: () => number): ReaderLeaseTestGraph {
  const value = createReaderLeaseTestGraph(1, { cursorCount, providerClockNow });
  graphs.push(value);
  return value;
}

function rule11(value: ReaderLeaseTestGraph) {
  return executeSQLiteCursorPublicationRebindRule11Intrinsic(
    publishReaderLeaseTestGraphSession(value),
  );
}

function expectCode(callback: () => unknown, code: string): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

afterEach(() => {
  for (const value of graphs.splice(0)) disposeReaderLeaseTestGraph(value);
});

describe("SQLite P10 Rule 12 and third-clock authority", () => {
  it.each([0, 1, 3])(
    "accepts the authentic bounded seal for %i cursors and stops at unconsumed clock 3/2",
    (cursorCount) => {
      const value = graph(cursorCount);
      const predecessor = rule11(value);
      const receipt = executeSQLiteCursorPublicationRule12Intrinsic(predecessor);
      const seal = readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt);
      const expected = assertSQLiteCursorPreRebindReceiptProvenance(
        value.preRebindReceipt,
      ).sealReceipt;

      expect(seal).toMatchObject({
        lifecycle: "active",
        ruleId: SQLITE_CURSOR_RULE12_ID_INTRINSIC,
        position: SQLITE_CURSOR_RULE12_POSITION_INTRINSIC,
        rule11Receipt: predecessor,
        b2CursorCount: cursorCount,
        mainKeyCount: cursorCount,
        driverCount: cursorCount,
        lookupCount: cursorCount,
        accumulatorCount: cursorCount,
        receiptImmutableRootSha256: expected.immutableRootSha256,
        computedImmutableRootSha256: expected.immutableRootSha256,
        maximumActiveCursors: cursorCount === 0 ? 1 : 2,
        maximumLivePhysicalRows: cursorCount === 0 ? 0 : 1,
        maximumLiveCarriers: cursorCount === 0 ? 0 : 1,
        violationCount: 0,
        diagnosticsTruncated: false,
      });
      expect(seal.order).toBe(SQLITE_CURSOR_RULE12_ORDER_INTRINSIC);
      expect(seal.queryPlans).toMatchObject({
        probeCount: 3,
        sorterFree: true,
        primaryKeyPointLookup: true,
      });
      expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor).lifecycle)
        .toBe("rule12-complete");
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).writePhase)
        .toBe("rule12-seal-accepted");

      expectCode(
        () => observeSQLiteCursorProviderClockIntrinsic(
          seal.providerClockCapability,
          "before-verification",
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      const third = observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt);
      const thirdSnapshot = readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic(
        receipt,
        third,
      );
      expect(thirdSnapshot).toMatchObject({
        boundary: "before-verification",
        consumer: "cursor-clock-capability",
        consumed: false,
        headIndex: 3,
        previousEvidence: seal.preRebindClockEvidence,
        rule12Receipt: receipt,
        rule11Receipt: predecessor,
        session: seal.session,
      });
      expectCode(
        () => consumeSQLiteCursorProviderClockEvidenceIntrinsic(
          seal.providerClockCapability,
          third,
          "cursor-clock-capability",
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expect(readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt).lifecycle)
        .toBe("pre-verification-clock-read-unconsumed");
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).writePhase)
        .toBe("pre-verification-clock-read-unconsumed");
    },
  );

  it("poisons the exact P10 graph on a generic fourth observation without presenting COMMIT", () => {
    let providerReads = 0;
    const value = graph(1, () => {
      providerReads += 1;
      return 1_785_110_405_000;
    });
    const receipt = executeSQLiteCursorPublicationRule12Intrinsic(rule11(value));
    const seal = readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt);
    observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt);
    expect(providerReads).toBe(3);

    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        seal.providerClockCapability,
        "before-commit",
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );

    expect(providerReads).toBe(3);
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    const outer = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    expect(outer.lifecycle).toBe("poisoned");
    expect(outer.writePhase).toBe("poisoned");
    expect(readSQLiteConnectionOwnerSnapshot(value.connection).isTransaction).toBe(true);
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        seal.providerClockCapability,
        "before-commit",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("authenticates cancellation before provider read three and poisons the accepted graph", () => {
    let providerReads = 0;
    const value = graph(1, () => {
      providerReads += 1;
      return 1_785_110_405_000;
    });
    const predecessor = rule11(value);
    const receipt = executeSQLiteCursorPublicationRule12Intrinsic(predecessor);
    expect(providerReads).toBe(2);
    const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    cancellation.cancel();
    expectCode(
      () => observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt, cancellation.signal),
      "GE_CYCLE_STORE_UNAVAILABLE",
    );
    expect(providerReads).toBe(2);
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it.each([
    [
      "live-lock",
      "GE_CYCLE_STORE_STALE_FENCE",
      (value: ReaderLeaseTestGraph) => value.connection.prepare(
        "UPDATE main.ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms + 1 WHERE singleton = 1",
        "inspect-schema",
      ).run(),
    ],
    [
      "target-catalog",
      "GE_CYCLE_STORE_CORRUPTION",
      (value: ReaderLeaseTestGraph) => value.connection.prepare(
        "CREATE INDEX main.ge_p10_cancel_hostile ON ge_cycle_cursors(kind)",
        "inspect-schema",
      ).run(),
    ],
  ] as const)(
    "lets current %s drift outrank an already-cancelled Rule 12 presentation",
    (_kind, code, mutate) => {
      let providerReads = 0;
      const value = graph(1, () => {
        providerReads += 1;
        return 1_785_110_405_000;
      });
      const predecessor = rule11(value);
      const predecessorSnapshot = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor);
      expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
        predecessorSnapshot.context,
      ).rule12QueryPlans).toMatchObject({
        probeCount: 3,
        sorterFree: true,
        primaryKeyPointLookup: true,
      });
      const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
      cancellation.cancel();
      mutate(value);
      expectCode(
        () => executeSQLiteCursorPublicationRule12Intrinsic(predecessor, cancellation.signal),
        code,
      );
      expect(providerReads).toBe(2);
      expectCode(
        () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      const outer = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
      expect(outer.lifecycle).toBe("poisoned");
      expect(outer.writePhase).toBe("poisoned");
    },
  );

  it.each([
    ["provider-throw", "GE_CYCLE_STORE_UNAVAILABLE", () => { throw new Error("provider"); }],
    ["unsafe", "GE_CYCLE_STORE_UNAVAILABLE", () => Number.MAX_SAFE_INTEGER + 1],
    ["regression", "GE_CYCLE_STORE_CORRUPTION", () => 1_785_110_404_999],
    ["expiry", "GE_CYCLE_STORE_STALE_FENCE", () => 1_785_110_505_000],
  ] as const)(
    "poisons without partial third evidence on %s",
    (_name, code, thirdValue) => {
      let providerReads = 0;
      const value = graph(1, () => {
        providerReads += 1;
        return providerReads === 3 ? thirdValue() : 1_785_110_405_000;
      });
      const receipt = executeSQLiteCursorPublicationRule12Intrinsic(rule11(value));
      expectCode(() => observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt), code);
      expect(providerReads).toBe(3);
      expectCode(
        () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
        .toBe("poisoned");
    },
  );

  it.each(["live-lock", "lineage"] as const)(
    "authenticates %s drift before provider read three and poisons the selected graph",
    (kind) => {
      let providerReads = 0;
      const value = graph(1, () => {
        providerReads += 1;
        return 1_785_110_405_000;
      });
      const receipt = executeSQLiteCursorPublicationRule12Intrinsic(rule11(value));
      if (kind === "live-lock") {
        value.connection.prepare(
          "UPDATE main.ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms + 1 WHERE singleton = 1",
          "inspect-schema",
        ).run();
      } else {
        value.connection.execTrusted("ROLLBACK", "inspect-schema");
        value.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      }
      expectCode(
        () => observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt),
        "GE_CYCLE_STORE_STALE_FENCE",
      );
      expect(providerReads).toBe(2);
      expectCode(
        () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
        .toBe("poisoned");
    },
  );

  it("poisons and clears authorization on a reentrant third provider callback", () => {
    let providerReads = 0;
    let receipt: SQLiteCursorRule12SuccessReceipt | undefined;
    const value = graph(1, () => {
      providerReads += 1;
      if (providerReads === 3) {
        observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt!);
      }
      return 1_785_110_405_000;
    });
    receipt = executeSQLiteCursorPublicationRule12Intrinsic(rule11(value));
    const seal = readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt);
    expectCode(
      () => observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt!),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(providerReads).toBe(3);
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        seal.providerClockCapability,
        "before-verification",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt!),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it.each([
    "evidence-binding",
    "outer-adoption",
    "selected-owner-binding",
  ] as const)(
    "keeps third %s failure atomic and preserves its exact primary",
    (point) => {
      let providerReads = 0;
      const value = graph(1, () => {
        providerReads += 1;
        return 1_785_110_405_000;
      });
      const receipt = executeSQLiteCursorPublicationRule12Intrinsic(rule11(value));
      const seal = readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt);
      const primary = new Error(`third ${point} primary`);
      let partial: ReturnType<typeof observeSQLiteCursorBeforeVerificationClockIntrinsic>
        | undefined;
      injectSQLiteCursorThirdRegistrationFaultForTestIntrinsic(
        point,
        primary,
        (evidence) => { partial = evidence; },
      );
      expect(() => observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt)).toThrow(primary);
      expect(providerReads).toBe(3);
      expect(partial).toBeDefined();
      expectCode(
        () => readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
          seal.providerClockCapability,
          partial!,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expectCode(
        () => readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic(
          receipt,
          partial!,
        ),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      expectCode(
        () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      const outer = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
      expect(outer.lifecycle).toBe("poisoned");
      expect(outer.writePhase).toBe("poisoned");
      expectCode(
        () => observeSQLiteCursorProviderClockIntrinsic(
          seal.providerClockCapability,
          "before-commit",
        ),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    },
  );

  it("observes upper cancellation during the bounded Rule 12 scan and never reads clock three", () => {
    let providerReads = 0;
    const value = graph(1, () => {
      providerReads += 1;
      return 1_785_110_405_000;
    });
    const predecessor = rule11(value);
    const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    cancellation.cancel();
    expectCode(
      () => executeSQLiteCursorPublicationRule12Intrinsic(predecessor, cancellation.signal),
      "GE_CYCLE_STORE_UNAVAILABLE",
    );
    expect(providerReads).toBe(2);
    expectCode(
      () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it.each([0, 1, 3])(
    "observes final cancellation after the complete %i-row seal validation",
    (cursorCount) => {
      let providerReads = 0;
      const value = graph(cursorCount, () => {
        providerReads += 1;
        return 1_785_110_405_000;
      });
      const predecessor = rule11(value);
      const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
      injectSQLiteCursorRule12PostSealValidationObserverForTestIntrinsic(() => {
        cancellation.cancel();
      });
      expectCode(
        () => executeSQLiteCursorPublicationRule12Intrinsic(predecessor, cancellation.signal),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      expect(providerReads).toBe(2);
      expectCode(
        () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
        "GE_CYCLE_STORE_CORRUPTION",
      );
      const outer = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
      expect(outer.lifecycle).toBe("poisoned");
      expect(outer.writePhase).toBe("poisoned");
      expect(readSQLiteConnectionOwnerSnapshot(value.connection).isTransaction).toBe(true);
    },
  );

  it("preserves an after-begin primary over Rule 12 cleanup failure", () => {
    const value = graph(1);
    const predecessor = rule11(value);
    const primary = new Error("post-seal primary");
    const cleanup = new Error("cleanup secondary");
    injectSQLiteCursorRule12PostSealValidationObserverForTestIntrinsic(() => {
      throw primary;
    });
    injectSQLiteCursorRule12CleanupFaultForTestIntrinsic(cleanup);
    expect(() => executeSQLiteCursorPublicationRule12Intrinsic(predecessor)).toThrow(primary);
    expectCode(
      () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it("fails closed on post-R11 main-table drift before any third provider read", () => {
    let providerReads = 0;
    const value = graph(1, () => {
      providerReads += 1;
      return 1_785_110_405_000;
    });
    const predecessor = rule11(value);
    value.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET authorization_hash = ?",
      "inspect-schema",
    ).run("f".repeat(64));
    expectCode(
      () => executeSQLiteCursorPublicationRule12Intrinsic(predecessor),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(providerReads).toBe(2);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it("rejects cloned, proxied, replayed, and cross-run receipt graphs", () => {
    const first = graph(1);
    const firstRule11 = rule11(first);
    const firstRule12 = executeSQLiteCursorPublicationRule12Intrinsic(firstRule11);
    const clone = Object.freeze(Object.create(null)) as SQLiteCursorRule12SuccessReceipt;
    const proxy = new Proxy(firstRule12, {});
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(clone),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(proxy),
      "GE_CYCLE_STORE_CORRUPTION",
    );

    const second = graph(1);
    const secondRule12 = executeSQLiteCursorPublicationRule12Intrinsic(rule11(second));
    const firstThird = observeSQLiteCursorBeforeVerificationClockIntrinsic(firstRule12);
    expectCode(
      () => readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic(
        secondRule12,
        firstThird,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => executeSQLiteCursorPublicationRule12Intrinsic(firstRule11),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("preserves thrown undefined at registration and poisons exact R11/outer", () => {
    const value = graph(1);
    const predecessor = rule11(value);
    injectSQLiteCursorRule12RegistrationFaultForTestIntrinsic(undefined);
    let caught: unknown = Symbol("not thrown");
    try {
      executeSQLiteCursorPublicationRule12Intrinsic(predecessor);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    expectCode(
      () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
      .toBe("poisoned");
  });

  it("poisons an already-registered receipt when outer adoption fails after R11 completion", () => {
    const value = graph(1);
    const predecessor = rule11(value);
    const primary = new Error("post-complete outer adoption fault");
    let registered: SQLiteCursorRule12SuccessReceipt | undefined;
    injectSQLiteCursorRule12PostRegistrationFailureObserverForTestIntrinsic((receipt) => {
      registered = receipt;
    });
    injectSQLiteCursorRule12SealAdoptionFaultForTestIntrinsic(primary);
    expect(() => executeSQLiteCursorPublicationRule12Intrinsic(predecessor)).toThrow(primary);
    expect(registered).toBeDefined();
    expectCode(
      () => readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(registered!),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(predecessor),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    const outer = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    expect(outer.lifecycle).toBe("poisoned");
    expect(outer.writePhase).toBe("poisoned");
  });

  it("uses definition-time EQP intrinsics under hostile live prototypes", () => {
    const value = graph(0);
    const stringIncludes = String.prototype.includes;
    const stringToUpperCase = String.prototype.toUpperCase;
    const arrayJoin = Array.prototype.join;
    const arrayPush = Array.prototype.push;
    try {
      String.prototype.includes = () => { throw new Error("live includes"); };
      String.prototype.toUpperCase = () => { throw new Error("live toUpperCase"); };
      Array.prototype.join = () => { throw new Error("live join"); };
      Array.prototype.push = () => { throw new Error("live push"); };
      expect(readSQLiteConnectionPostRebindSealQueryPlansIntrinsic(value.connection))
        .toMatchObject({ probeCount: 3, sorterFree: true, primaryKeyPointLookup: true });
    } finally {
      String.prototype.includes = stringIncludes;
      String.prototype.toUpperCase = stringToUpperCase;
      Array.prototype.join = arrayJoin;
      Array.prototype.push = arrayPush;
    }
  });

  it("keeps Rule 12, raw clock authority, and COMMIT authority package-private", () => {
    for (const name of [
      "executeSQLiteCursorPublicationRule12Intrinsic",
      "observeSQLiteCursorBeforeVerificationClockIntrinsic",
      "observeSQLiteCursorProviderClockIntrinsic",
      "consumeSQLiteCursorProviderClockEvidenceIntrinsic",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
    const rule12Source = readFileSync(new URL(
      "../src/cursor-publication-rule12.ts",
      import.meta.url,
    ), "utf8");
    const clockSource = readFileSync(new URL(
      "../src/cursor-publication-clock-authority.ts",
      import.meta.url,
    ), "utf8");
    const connectionSource = readFileSync(new URL(
      "../src/sqlite-connection.ts",
      import.meta.url,
    ), "utf8");
    expect(rule12Source).not.toMatch(/StatementSync|decodeSQLiteCursorSealRow|new SQLiteCursorSealAccumulator/u);
    expect(clockSource).toContain("beforeVerificationAuthorized");
    expect(clockSource).toContain("is not consumable in the current protocol phase");
    expect(clockSource).not.toMatch(/execTrusted\([^)]*COMMIT/u);
    expect(connectionSource).toContain("const stringIncludesIntrinsic = String.prototype.includes");
    expect(connectionSource).toContain("const arrayJoinIntrinsic = Array.prototype.join");
    expect(connectionSource).toContain("if (details.length !== 1)");
  });

  it("passes the isolated bounded Rule 12 plus unconsumed-third GC probe", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        vitest,
        "run",
        "test/probes/cursor-publication-rule12-clock-gc.probe.test.ts",
        "--pool=threads",
        "--maxWorkers=1",
        "--fileParallelism=false",
        "--reporter=dot",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, GRAPH_ENGINEERING_RUN_RULE12_CLOCK_GC_PROBE: "1" },
        timeout: 150_000,
      },
    );
    expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
    expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
    expect(result.status, [
      "isolated Rule 12/third GC probe failed",
      `stdout=${result.stdout}`,
      `stderr=${result.stderr}`,
    ].join("\n")).toBe(0);
  }, 160_000);
});
