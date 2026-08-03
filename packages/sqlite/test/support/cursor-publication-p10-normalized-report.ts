import type { SQLiteCursorBeforeVerificationClockEvidenceSnapshot } from
  "../../src/cursor-publication-clock-authority.js";
import type { SQLiteCursorOuterPublicationAuthoritySnapshot } from
  "../../src/cursor-publication-outer-authority.js";
import type { SQLiteCursorRule12SuccessReceiptSnapshot } from
  "../../src/cursor-publication-rule12.js";

export const SQLITE_CURSOR_P10_PARITY_REPORT_VERSION =
  "sqlite-cursor-publication-p10-parity/v1" as const;

export type SQLiteCursorP10ParityFailureCase = "cancel" | "provider" | "replay";

export interface SQLiteCursorP10NormalizedSuccessCase {
  readonly case: `success-${0 | 1 | 3}`;
  readonly status: "success";
  readonly rule12: Readonly<{
    readonly ruleId: "BLR_CURSOR_SEAL_MISMATCH";
    readonly position: 12;
    readonly counts: Readonly<{
      readonly b2: number;
      readonly main: number;
      readonly driver: number;
      readonly lookup: number;
      readonly accumulator: number;
    }>;
    readonly root: Readonly<{ readonly sha256: string; readonly matchesReceipt: boolean }>;
    readonly phase: "pre-verification-clock-read-unconsumed";
  }>;
  readonly thirdClock: Readonly<{
    readonly boundary: "before-verification";
    readonly head: 3;
    readonly consumed: false;
  }>;
  readonly commitPresented: false;
}

export interface SQLiteCursorP10NormalizedFailureCase {
  readonly case: SQLiteCursorP10ParityFailureCase;
  readonly status: "failure";
  readonly code: string;
  readonly rule12AcceptedBeforeFailure: boolean;
  readonly outerLifecycle: "poisoned";
  readonly thirdClockRead: false;
  readonly commitPresented: false;
}

export interface SQLiteCursorP10NormalizedParityReport {
  readonly version: typeof SQLITE_CURSOR_P10_PARITY_REPORT_VERSION;
  readonly implementation: "typescript";
  readonly cases: readonly (
    SQLiteCursorP10NormalizedSuccessCase | SQLiteCursorP10NormalizedFailureCase
  )[];
}

export function normalizeSQLiteCursorP10SuccessCase(
  rule12: SQLiteCursorRule12SuccessReceiptSnapshot,
  third: SQLiteCursorBeforeVerificationClockEvidenceSnapshot,
): SQLiteCursorP10NormalizedSuccessCase {
  if ((rule12.b2CursorCount !== 0 && rule12.b2CursorCount !== 1
      && rule12.b2CursorCount !== 3)
      || rule12.lifecycle !== "pre-verification-clock-read-unconsumed"
      || third.headIndex !== 3 || third.consumed
      || third.boundary !== "before-verification") {
    throw new Error("SQLite P10 success graph cannot be normalized");
  }
  return Object.freeze({
    case: `success-${rule12.b2CursorCount}` as const,
    status: "success" as const,
    rule12: Object.freeze({
      ruleId: rule12.ruleId,
      position: rule12.position,
      counts: Object.freeze({
        b2: rule12.b2CursorCount,
        main: rule12.mainKeyCount,
        driver: rule12.driverCount,
        lookup: rule12.lookupCount,
        accumulator: rule12.accumulatorCount,
      }),
      root: Object.freeze({
        sha256: rule12.computedImmutableRootSha256,
        matchesReceipt:
          rule12.computedImmutableRootSha256 === rule12.receiptImmutableRootSha256,
      }),
      phase: rule12.lifecycle,
    }),
    thirdClock: Object.freeze({
      boundary: third.boundary,
      head: third.headIndex,
      consumed: third.consumed,
    }),
    commitPresented: false as const,
  });
}

export function normalizeSQLiteCursorP10FailureCase(
  caseName: SQLiteCursorP10ParityFailureCase,
  code: string,
  rule12AcceptedBeforeFailure: boolean,
  outer: SQLiteCursorOuterPublicationAuthoritySnapshot,
): SQLiteCursorP10NormalizedFailureCase {
  if (outer.lifecycle !== "poisoned" || typeof code !== "string" || code.length === 0) {
    throw new Error("SQLite P10 failure graph cannot be normalized");
  }
  return Object.freeze({
    case: caseName,
    status: "failure" as const,
    code,
    rule12AcceptedBeforeFailure,
    outerLifecycle: outer.lifecycle,
    thirdClockRead: false as const,
    commitPresented: false as const,
  });
}

export function createSQLiteCursorP10NormalizedParityReport(
  cases: SQLiteCursorP10NormalizedParityReport["cases"],
): SQLiteCursorP10NormalizedParityReport {
  return Object.freeze({
    version: SQLITE_CURSOR_P10_PARITY_REPORT_VERSION,
    implementation: "typescript" as const,
    cases: Object.freeze([...cases]),
  });
}
