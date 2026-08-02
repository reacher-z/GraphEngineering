/**
 * Honest publication-session hostile execution accounting.
 *
 * This module deliberately contains no normalized expected records. The
 * comparator must expand those from the frozen fixture so a reporter cannot
 * weaken its own oracle.
 */

export const SESSION_CANDIDATE_ORDINALS = Object.freeze([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  20, 26, 46, 47, 48, 100, 101, 102,
]);

export const SESSION_ACTIVATED_ORDINALS = Object.freeze([20, 100, 101, 102]);

export const SESSION_UNAVAILABLE = Object.freeze([
  Object.freeze({
    ordinals: Object.freeze([2, 3, 4, 5, 6, 14, 15, 26]),
    reason: "privately-derived-edge-has-no-real-session-injection-seam",
  }),
  Object.freeze({
    ordinals: Object.freeze([7, 48]),
    reason: "future-publication-session-consumer-or-cursor-clock-leaf-not-implemented",
  }),
  Object.freeze({
    ordinals: Object.freeze([8, 9, 10, 11, 12, 13, 16, 17]),
    reason: "real-selected-graph-path-is-terminal-not-frozen-healthy-rejection",
  }),
  Object.freeze({
    ordinals: Object.freeze([18]),
    reason: "typescript-stale-fence-retires-while-frozen-record-requires-poison",
  }),
  Object.freeze({
    ordinals: Object.freeze([46]),
    reason: "atomic-session-publication-consumes-second-evidence-with-no-unconsumed-active-seam",
  }),
  Object.freeze({
    ordinals: Object.freeze([47]),
    reason: "real-selected-graph-substitution-poisons-while-frozen-record-requires-healthy-rejection",
  }),
]);

export const ACTIVATED_RECORD_FIELDS = Object.freeze([
  "ordinal",
  "runtimeError",
  "semanticErrorCode",
  "sameGraphRetryable",
  "freshGraphSucceeded",
  "normalized",
]);

const TYPESCRIPT_RAW_ERRORS = Object.freeze({
  20: "CycleStoreProviderError|GE_CYCLE_STORE_CORRUPTION|inspect-schema|SQLite publication session evidence is invalid",
  100: "CycleStoreProviderError|GE_CYCLE_STORE_CORRUPTION|inspect-schema|SQLite publication session adoption receipt is invalid",
  101: "CycleStoreProviderError|GE_CYCLE_STORE_CORRUPTION|inspect-schema|SQLite publication session adoption receipt is invalid",
  102: "CycleStoreProviderError|GE_CYCLE_STORE_CORRUPTION|inspect-schema|SQLite publication session adoption receipt is invalid",
});

const PYTHON_RAW_ERRORS = Object.freeze({
  20: "ValueError|GE_CURSOR_B3_PUBLICATION_SESSION_EVIDENCE",
  100: "ValueError|GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH",
  101: "ValueError|GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH",
  102: "ValueError|GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH",
});

export const SESSION_RUNTIME_ERROR_ORACLE = Object.freeze({
  typescript: TYPESCRIPT_RAW_ERRORS,
  python: PYTHON_RAW_ERRORS,
});

const SEMANTIC_FIELDS = new Set([
  "caseId",
  "outcome",
  "failureBoundary",
  "state",
  "poisoned",
  "bundleRetryable",
  "sameTransactionLineage",
  "catalogFenceMatches",
]);

export function expandHostileRecord(fixture, ordinal) {
  const parity = fixture.parityGates.initialPublicationNormalizedOutput;
  const contract = fixture.hostileExecutionContract;
  const record = contract.records.find((candidate) => candidate.ordinal === ordinal);
  if (record === undefined) throw new Error(`unknown hostile ordinal ${String(ordinal)}`);
  const profile = contract.counterProfiles[record.expectedCounterProfile];
  if (profile === undefined) {
    throw new Error(`unknown hostile counter profile ${String(record.expectedCounterProfile)}`);
  }
  return Object.freeze(Object.fromEntries(parity.orderedFields.map((field) => [
    field,
    field === "caseId" ? record.id
      : SEMANTIC_FIELDS.has(field) ? record.expected[field]
        : profile[field],
  ])));
}

export function expectedActivatedRecord(fixture, runtime, ordinal) {
  const raw = SESSION_RUNTIME_ERROR_ORACLE[runtime]?.[ordinal];
  if (raw === undefined) {
    throw new Error(`no ${String(runtime)} raw-error oracle for hostile ordinal ${String(ordinal)}`);
  }
  const record = fixture.hostileExecutionContract.records.find(
    (candidate) => candidate.ordinal === ordinal,
  );
  if (record === undefined) throw new Error(`unknown hostile ordinal ${String(ordinal)}`);
  return Object.freeze({
    ordinal,
    runtimeError: raw,
    semanticErrorCode: record.expectedCode,
    sameGraphRetryable: false,
    freshGraphSucceeded: true,
    normalized: expandHostileRecord(fixture, ordinal),
  });
}

export function assertHonestActivationAccounting(fixture) {
  const records = fixture.hostileExecutionContract.records;
  if (records.length !== 145 || fixture.hostileExecutionContract.runtimeExecutionEvidenceClaim) {
    throw new Error("publication hostile registry dimensions or claim changed");
  }
  const candidateSet = new Set(SESSION_CANDIDATE_ORDINALS);
  const unavailable = SESSION_UNAVAILABLE.flatMap(({ ordinals }) => ordinals);
  const accounted = [...SESSION_ACTIVATED_ORDINALS, ...unavailable];
  if (candidateSet.size !== 25 || accounted.length !== 25
      || new Set(accounted).size !== 25
      || accounted.some((ordinal) => !candidateSet.has(ordinal))) {
    throw new Error("publication-session hostile accounting is incomplete or overlapping");
  }
  for (const ordinal of SESSION_CANDIDATE_ORDINALS) {
    const record = records[ordinal - 1];
    if (record?.ordinal !== ordinal
        || !["publication-session", "pre-rebind-clock"].includes(record.phase)) {
      throw new Error(`publication-session hostile candidate ${String(ordinal)} drifted`);
    }
  }
  return Object.freeze({ activated: 4, candidates: 25, registry: 145 });
}
