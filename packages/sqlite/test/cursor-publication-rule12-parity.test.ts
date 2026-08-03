import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  observeSQLiteCursorBeforeVerificationClockIntrinsic,
  readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic,
} from "../src/cursor-publication-clock-authority.js";
import {
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
} from "../src/cursor-publication-outer-authority.js";
import { executeSQLiteCursorPublicationRebindRule11Intrinsic } from
  "../src/cursor-publication-rebind.js";
import {
  executeSQLiteCursorPublicationRule12Intrinsic,
  readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic,
} from "../src/cursor-publication-rule12.js";
import {
  SQLITE_CURSOR_P10_PARITY_REPORT_VERSION,
  createSQLiteCursorP10NormalizedParityReport,
  normalizeSQLiteCursorP10FailureCase,
  normalizeSQLiteCursorP10SuccessCase,
  type SQLiteCursorP10NormalizedFailureCase,
  type SQLiteCursorP10NormalizedSuccessCase,
} from "./support/cursor-publication-p10-normalized-report.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  publishReaderLeaseTestGraphSession,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];
const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const uvAvailability = spawnSync("uv", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 10_000,
});
if (process.env.GRAPH_ENGINEERING_REQUIRE_P10_CROSS_RUNTIME === "1"
    && (uvAvailability.error !== undefined || uvAvailability.status !== 0)) {
  throw new Error("P10 cross-runtime parity requires an available uv executable");
}
const crossRuntimeIt = uvAvailability.error === undefined && uvAvailability.status === 0
  ? it
  : it.skip;

interface P10ReportEnvelope {
  readonly version: typeof SQLITE_CURSOR_P10_PARITY_REPORT_VERSION;
  readonly implementation: "typescript" | "python";
  readonly cases: readonly (
    SQLiteCursorP10NormalizedSuccessCase | SQLiteCursorP10NormalizedFailureCase
  )[];
}

function track(value: ReaderLeaseTestGraph): ReaderLeaseTestGraph {
  graphs.push(value);
  return value;
}

function predecessor(value: ReaderLeaseTestGraph) {
  return executeSQLiteCursorPublicationRebindRule11Intrinsic(
    publishReaderLeaseTestGraphSession(value),
  );
}

function failureCode(callback: () => unknown): string {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    return (error as CycleStoreProviderError).code;
  }
  throw new Error("expected normalized failure");
}

function typescriptReport(): P10ReportEnvelope {
  const cases: Array<
    SQLiteCursorP10NormalizedSuccessCase | SQLiteCursorP10NormalizedFailureCase
  > = [0, 1, 3].map((cursorCount) => {
    const value = track(createReaderLeaseTestGraph(1, {
      cursorCount,
      cursorFixture: "python-p10-parity",
    }));
    const receipt = executeSQLiteCursorPublicationRule12Intrinsic(predecessor(value));
    const third = observeSQLiteCursorBeforeVerificationClockIntrinsic(receipt);
    return normalizeSQLiteCursorP10SuccessCase(
      readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(receipt),
      readSQLiteCursorBeforeVerificationClockEvidenceSnapshotIntrinsic(receipt, third),
    );
  });

  const replayGraph = track(createReaderLeaseTestGraph(1, { cursorCount: 1 }));
  const replayPredecessor = predecessor(replayGraph);
  executeSQLiteCursorPublicationRule12Intrinsic(replayPredecessor);
  cases.push(normalizeSQLiteCursorP10FailureCase(
    "replay",
    failureCode(() => executeSQLiteCursorPublicationRule12Intrinsic(replayPredecessor)),
    true,
    readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(replayGraph.authority),
  ));

  const cancelGraph = track(createReaderLeaseTestGraph(1, { cursorCount: 1 }));
  const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
  cancellation.cancel();
  cases.push(normalizeSQLiteCursorP10FailureCase(
    "cancel",
    failureCode(() => executeSQLiteCursorPublicationRule12Intrinsic(
      predecessor(cancelGraph),
      cancellation.signal,
    )),
    false,
    readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(cancelGraph.authority),
  ));

  let providerRead = 0;
  const providerGraph = track(createReaderLeaseTestGraph(1, {
    cursorCount: 1,
    providerClockNow: () => {
      providerRead += 1;
      if (providerRead === 3) throw new Error("provider unavailable");
      return 1_785_110_405_000;
    },
  }));
  const providerReceipt = executeSQLiteCursorPublicationRule12Intrinsic(
    predecessor(providerGraph),
  );
  cases.push(normalizeSQLiteCursorP10FailureCase(
    "provider",
    failureCode(() => observeSQLiteCursorBeforeVerificationClockIntrinsic(providerReceipt)),
    true,
    readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(providerGraph.authority),
  ));
  return createSQLiteCursorP10NormalizedParityReport(cases);
}

function portableOnly(report: P10ReportEnvelope): Omit<P10ReportEnvelope, "implementation"> {
  const { implementation: _implementation, ...portable } = report;
  return portable;
}

function pythonReport(): Readonly<{ report: P10ReportEnvelope; stdout: string }> {
  const script = join(
    repositoryRoot,
    "python/tests/sqlite_cursor_publication_rule12_clock_report.py",
  );
  const result = spawnSync(
    "uv",
    ["run", "--project", "python", "python", script],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 180_000,
    },
  );
  expect(result.error, `Python P10 reporter spawn failed: ${String(result.error)}`).toBeUndefined();
  expect(result.signal, `Python P10 reporter terminated: ${result.stderr}`).toBeNull();
  expect(result.status, `Python P10 reporter failed: ${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stdout.match(/\n/gu)).toHaveLength(1);
  const decoded = JSON.parse(result.stdout) as P10ReportEnvelope;
  expect(result.stdout).toBe(`${JSON.stringify(decoded)}\n`);
  return { report: decoded, stdout: result.stdout };
}

afterEach(() => {
  for (const value of graphs.splice(0)) disposeReaderLeaseTestGraph(value);
});

describe("SQLite P10 portable normalized parity report", () => {
  it("generates stable 0/1/3 success and representative failure cases", () => {
    const report = typescriptReport();
    expect(Object.isFrozen(report)).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      version: "sqlite-cursor-publication-p10-parity/v1",
      implementation: "typescript",
      cases: [
        { case: "success-0", status: "success", commitPresented: false },
        { case: "success-1", status: "success", commitPresented: false },
        { case: "success-3", status: "success", commitPresented: false },
        {
          case: "replay",
          status: "failure",
          code: "GE_CYCLE_STORE_CORRUPTION",
          thirdClockRead: false,
          commitPresented: false,
        },
        {
          case: "cancel",
          status: "failure",
          code: "GE_CYCLE_STORE_UNAVAILABLE",
          thirdClockRead: false,
          commitPresented: false,
        },
        {
          case: "provider",
          status: "failure",
          code: "GE_CYCLE_STORE_UNAVAILABLE",
          thirdClockRead: false,
          commitPresented: false,
        },
      ],
    });
    for (const success of report.cases.slice(0, 3)) {
      expect(success).toMatchObject({
        rule12: {
          ruleId: "BLR_CURSOR_SEAL_MISMATCH",
          position: 12,
          root: { matchesReceipt: true },
          phase: "pre-verification-clock-read-unconsumed",
        },
        thirdClock: { boundary: "before-verification", head: 3, consumed: false },
        commitPresented: false,
      });
    }
  });

  crossRuntimeIt(
    "matches deterministic canonical real-SQLite evidence with Python byte-for-byte",
    () => {
      const typescript = typescriptReport();
      const first = pythonReport();
      const second = pythonReport();
      expect(typescript.implementation).toBe("typescript");
      expect(first.report.implementation).toBe("python");
      expect(second.report.implementation).toBe("python");
      expect(second.stdout).toBe(first.stdout);
      expect(JSON.stringify(portableOnly(typescript)))
        .toBe(JSON.stringify(portableOnly(first.report)));
    },
    420_000,
  );
});
