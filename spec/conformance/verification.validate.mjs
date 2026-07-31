#!/usr/bin/env node
//
// Independent oracle for spec/conformance/verification.case.json.
//
// Every literal in the corpus is recomputed here from the rules stated in
// spec/verification-semantics.md alone. Nothing is imported from a language
// runtime, nothing is copied from another conformance fixture, and no constant
// is read out of the corpus: the corpus must agree with the constants
// transcribed below, not define them. A single wrong byte anywhere in the
// corpus must make this module throw.
//
// Two properties are deliberately engineered into the shape of this file.
//
//  1. Every rejection is a `check(guardId, ...)` call with a unique guard
//     identifier, and every negative vector in the corpus names the guard it
//     targets rather than a portable failure code. Two rules that report the
//     same portable code are still distinct guards and still need distinct
//     vectors, so the "shadowed by a neighbour reporting the same code" failure
//     mode cannot occur here.
//
//  2. Every guard records a *touch* whenever its predicate is evaluated, so a
//     guard no fixture ever reaches is a hard failure, and the whole corpus is
//     re-run once per guard with that guard neutralized. A guard whose
//     neutralization leaves the corpus green is a survivor and is reported by
//     name.
//
// No provider call, model invocation, network access or wall-clock read appears
// anywhere in this file or in the corpus it validates.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "verification.case.json");

const SCHEMA_FILES = Object.freeze({
  rubric: "rubric.schema.json",
  verdict: "verdict.schema.json",
  panel: "judge-panel.schema.json",
  citation: "citation-claim.schema.json",
  reflection: "reflection-record.schema.json",
});

// Frozen contracts this one composes with. They are read, never rewritten.
const BARRIER_DECISION_SCHEMA = "barrier-decision.schema.json";
const BARRIER_VOTE_SCHEMA = "barrier-vote.schema.json";

// ---------------------------------------------------------------------------
// Contract constants, transcribed from spec/verification-semantics.md.
// ---------------------------------------------------------------------------

const CONTRACT = "graphengineering.reacher-z.github.io/verification/v1alpha1";
const BARRIER_CONTRACT_API_VERSION = "graphengineering.reacher-z.github.io/barrier/v1alpha1";

const RUBRIC_DOMAIN = "graphengineering.rubric.v1alpha1";
const VERDICT_DOMAIN = "graphengineering.verifier-verdict.v1alpha1";
const CLAIM_DOMAIN = "graphengineering.claim.v1alpha1";
const PANEL_DECISION_DOMAIN = "graphengineering.panel-decision.v1alpha1";
const REFLECTION_DOMAIN = "graphengineering.reflection.v1alpha1";
// Reused verbatim from integrated-barrier-semantics.md for the composition proof.
const BARRIER_POLICY_DOMAIN = "graphengineering.policy.v1alpha1";
const BARRIER_DECISION_DOMAIN = "graphengineering.barrier-decision.v1alpha1";

const LENSES = Object.freeze([
  "correctness",
  "security",
  "performance",
  "reproducibility",
  "compatibility",
  "operability",
  "source-quality",
  "evidence-citation",
]);
const SEVERITIES = Object.freeze(["blocking", "major", "minor", "advisory"]);
const BALLOT_VERDICTS = Object.freeze(["pass", "reject", "abstain", "unknown"]);
const CENSUS_VERDICTS = Object.freeze(["pass", "reject", "abstain", "unknown", "not-cast"]);
const NOT_CAST = "not-cast";
const PARTICIPATIONS = Object.freeze(["counted", "excluded", "missing", "timed_out"]);
const EXCLUSION_CODES = Object.freeze([
  "MAKER_VERIFIER_IDENTITY_COLLISION",
  "SHARED_CONTEXT_DENIED",
  "EVIDENCE_NOT_ORIGINAL",
  "SEPARATION_PROOF_ABSENT",
  "RUBRIC_HASH_MISMATCH",
  "CAPABILITY_DENIED",
]);
const CRITERION_BASES = Object.freeze(["deterministic", "model-judgment"]);
const CRITERION_OUTCOMES = Object.freeze(["pass", "reject", "unknown"]);
const THRESHOLD_KINDS = Object.freeze(["all", "minimum", "percentage", "quorum"]);
const REASON_CODES = Object.freeze([
  "NO_ITEMS",
  "ALL_SUCCEEDED",
  "ALL_NOT_SUCCEEDED",
  "MINIMUM_MET",
  "MINIMUM_NOT_MET",
  "MINIMUM_EXCEEDS_TOTAL",
  "PERCENTAGE_MET",
  "PERCENTAGE_NOT_MET",
  "QUORUM_MET",
  "QUORUM_NOT_MET",
  "QUORUM_EXCEEDS_PARTICIPANTS",
]);
const REASON_CLASSES = Object.freeze(["satisfied", "unsatisfied", "insufficient"]);
// The total, disjoint 4 + 4 + 3 partition of section 8.3.
const REASON_CLASS_OF = Object.freeze({
  ALL_SUCCEEDED: "satisfied",
  MINIMUM_MET: "satisfied",
  PERCENTAGE_MET: "satisfied",
  QUORUM_MET: "satisfied",
  ALL_NOT_SUCCEEDED: "unsatisfied",
  MINIMUM_NOT_MET: "unsatisfied",
  PERCENTAGE_NOT_MET: "unsatisfied",
  QUORUM_NOT_MET: "unsatisfied",
  NO_ITEMS: "insufficient",
  MINIMUM_EXCEEDS_TOTAL: "insufficient",
  QUORUM_EXCEEDS_PARTICIPANTS: "insufficient",
});
const RESOLUTIONS = Object.freeze(["pass", "reject", "unknown", "human"]);
const TERMINALS = Object.freeze(["succeeded", "failed", "unknown", "awaiting_human"]);
const TERMINAL_OF = Object.freeze({
  pass: "succeeded",
  reject: "failed",
  unknown: "unknown",
  human: "awaiting_human",
});
const AGGREGATIONS = Object.freeze(["sum-of-normalized", "borda-count"]);
const TIE_BREAK_RUNGS = Object.freeze([
  "highest-minimum-score",
  "highest-median-score",
  "most-first-ranks",
  "fewest-blocking-findings",
  "earliest-declared-candidate",
  "lowest-content-hash",
]);
const CITATION_OUTCOMES = Object.freeze(["supported", "contradicted", "insufficient", "inaccessible"]);
const SUPPORT_MODES = Object.freeze(["direct", "inferred"]);
// Declaration order is normative: `defects` is emitted in exactly this order.
const CITATION_DEFECTS = Object.freeze([
  "SOURCE_NOT_FOUND",
  "SOURCE_UNREACHABLE",
  "FABRICATED_LOCATOR",
  "DIGEST_MISMATCH",
  "STALE_VERSION",
  "EXCERPT_NOT_IN_SOURCE",
  "CONTRADICTED_BY_SOURCE",
  "CIRCULAR_REFERENCE",
  "CITATION_LAUNDERING",
  "AUTHORITY_UNVERIFIED",
  "EXCERPT_LIMIT_EXCEEDED",
]);
const INACCESSIBILITY_DEFECTS = Object.freeze(["SOURCE_NOT_FOUND", "SOURCE_UNREACHABLE"]);
// Defects that can only be observed after the source was actually read, and
// therefore can never accompany `inaccessible`.
const REACHABLE_ONLY_DEFECTS = Object.freeze([
  "DIGEST_MISMATCH",
  "STALE_VERSION",
  "EXCERPT_NOT_IN_SOURCE",
  "CONTRADICTED_BY_SOURCE",
  "CITATION_LAUNDERING",
  "AUTHORITY_UNVERIFIED",
  "EXCERPT_LIMIT_EXCEEDED",
]);
const REFLECTION_STOP_REASONS = Object.freeze([
  "converged",
  "revision-limit",
  "unknown-evidence",
  "no-progress",
  "ceiling-exhausted",
  "cancelled",
]);
const FAILURE_CODES = Object.freeze([
  "VERIFICATION_REJECTED",
  "INVALID_VERIFIER_VERDICT",
  "PANEL_CENSUS_INCOMPLETE",
  "RUBRIC_DRIFT",
  "CANDIDATE_SET_MUTATED",
  "SYNTHESIS_UNCITED",
  "CITATION_UNVERIFIED",
  "PANEL_CEILING_EXCEEDED",
]);
const REUSED_CODES = Object.freeze([
  "DECISION_IDENTITY_MISMATCH",
  "DUPLICATE_DECISION",
  "UPSTREAM_FAILED",
  "UPSTREAM_UNKNOWN",
  "INVALID_BARRIER_VOTE",
  "BARRIER_NOT_SATISFIED",
]);
const REPLAY_REJECTION_CODES = Object.freeze([
  "RUBRIC_DRIFT",
  "DECISION_IDENTITY_MISMATCH",
  "DUPLICATE_DECISION",
]);

// Section 13.1: the total, frozen seat-to-barrier projection.
const BARRIER_PROJECTION = Object.freeze([
  { participation: "counted", verdict: "pass", disposition: "succeeded", voteRecordVerdict: "accept" },
  { participation: "counted", verdict: "reject", disposition: "failed", voteRecordVerdict: "reject" },
  { participation: "counted", verdict: "abstain", disposition: "abstained", voteRecordVerdict: "abstain" },
  { participation: "counted", verdict: "unknown", disposition: "unknown", voteRecordVerdict: "unknown" },
  { participation: "excluded", verdict: NOT_CAST, disposition: "missing", voteRecordVerdict: NOT_CAST },
  { participation: "missing", verdict: NOT_CAST, disposition: "missing", voteRecordVerdict: NOT_CAST },
  { participation: "timed_out", verdict: NOT_CAST, disposition: "timed_out", voteRecordVerdict: NOT_CAST },
]);
const BALLOT_TO_BARRIER_VERDICT = Object.freeze({
  pass: "accept",
  reject: "reject",
  abstain: "abstain",
  unknown: "unknown",
});
const DISPOSITION_TO_COUNT = Object.freeze({
  succeeded: "succeeded",
  failed: "failed",
  missing: "missing",
  timed_out: "timedOut",
  abstained: "abstained",
  unknown: "unknown",
});
const DISPOSITION_TO_ID_LIST = Object.freeze({
  succeeded: "acceptedIds",
  failed: "failedIds",
  missing: "missingIds",
  timed_out: "timedOutIds",
  abstained: "abstainedIds",
  unknown: "unknownIds",
});
const NOT_CAST_SEAT_KEYS = Object.freeze(["verifierId", "lens", "participation", "verdict"]);
const NOT_CAST_BARRIER_RECORD_KEYS = Object.freeze(["sourceNodeId", "verdict"]);

const VOCABULARIES = Object.freeze({
  lens: LENSES,
  severity: SEVERITIES,
  ballotVerdict: BALLOT_VERDICTS,
  censusVerdict: CENSUS_VERDICTS,
  participation: PARTICIPATIONS,
  exclusionCode: EXCLUSION_CODES,
  criterionBasis: CRITERION_BASES,
  criterionOutcome: CRITERION_OUTCOMES,
  thresholdKind: THRESHOLD_KINDS,
  reasonCode: REASON_CODES,
  reasonClass: REASON_CLASSES,
  resolution: RESOLUTIONS,
  terminal: TERMINALS,
  aggregation: AGGREGATIONS,
  tieBreakRung: TIE_BREAK_RUNGS,
  citationOutcome: CITATION_OUTCOMES,
  supportMode: SUPPORT_MODES,
  citationDefect: CITATION_DEFECTS,
  reflectionStopReason: REFLECTION_STOP_REASONS,
  failureCode: FAILURE_CODES,
});

// ---------------------------------------------------------------------------
// Guard machinery.
// ---------------------------------------------------------------------------

class GuardError extends Error {
  constructor(guardId, message) {
    super(`[${guardId}] ${message}`);
    this.name = "GuardError";
    this.guardId = guardId;
  }
}

let disabledGuard = null;
const touchedGuards = new Set();
const declaredGuards = new Set();

function guard(guardId, description) {
  assert.ok(/^[A-Z]{1,2}[0-9]{3}$/u.test(guardId), `malformed guard identifier ${guardId}`);
  assert.equal(declaredGuards.has(guardId), false, `duplicate guard identifier ${guardId}`);
  declaredGuards.add(guardId);
  GUARD_DESCRIPTIONS.set(guardId, description);
  return guardId;
}

const GUARD_DESCRIPTIONS = new Map();

/** Every rejection in this oracle goes through here. */
function check(guardId, ok, message) {
  assert.ok(declaredGuards.has(guardId), `undeclared guard ${guardId}`);
  touchedGuards.add(guardId);
  if (ok === true) return;
  if (disabledGuard === guardId) return;
  throw new GuardError(guardId, message);
}

function checkEqual(guardId, actual, expected, message) {
  check(guardId, deepEqual(actual, expected), `${message}: expected ${stable(expected)}, saw ${stable(actual)}`);
}

// ---------------------------------------------------------------------------
// Portable primitives.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left].map((point) => point.codePointAt(0));
  const rightPoints = [...right].map((point) => point.codePointAt(0));
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalSerialize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "canonical numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  assert.ok(isPlainObject(value), "canonical values must be portable JSON");
  return `{${Object.keys(value)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
    .join(",")}}`;
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/** frame(s) = uint32be(byteLength(utf8(s))) || utf8(s), reused verbatim. */
function frame(text) {
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([header, bytes]);
}

function framedDigest(parts) {
  return sha256Hex(Buffer.concat(parts.map(frame)));
}

function textDigest(text) {
  return sha256Hex(Buffer.from(text, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  return typeof value === "string" ? JSON.stringify(value) : canonicalSerialize(value ?? null);
}

function deepEqual(left, right) {
  return canonicalSerialize(left ?? null) === canonicalSerialize(right ?? null);
}

function without(document, key) {
  const copy = { ...document };
  delete copy[key];
  return copy;
}

function countBy(items, predicate) {
  return items.reduce((total, item) => total + (predicate(item) ? 1 : 0), 0);
}

function codePoints(text) {
  return [...text];
}

// ---------------------------------------------------------------------------
// Identities (section 3).
// ---------------------------------------------------------------------------

function computeRubricHash(rubric) {
  return framedDigest([RUBRIC_DOMAIN, canonicalSerialize(without(rubric, "rubricHash"))]);
}

function computeVerdictHash(verdict) {
  return framedDigest([
    VERDICT_DOMAIN,
    verdict.runId,
    verdict.verifierId,
    canonicalSerialize(without(verdict, "verdictHash")),
  ]);
}

function computeClaimHash(claim) {
  return framedDigest([CLAIM_DOMAIN, canonicalSerialize(without(claim, "claimHash"))]);
}

function computePanelDecisionId(document, overrides = {}) {
  const runId = overrides.runId ?? document.runId;
  const graphRevision = overrides.graphRevision ?? document.graphRevision;
  const panelNodeId = overrides.panelNodeId ?? document.panelNodeId;
  assert.ok(Number.isSafeInteger(graphRevision) && graphRevision >= 0, "graphRevision must be a safe non-negative integer");
  return framedDigest([
    PANEL_DECISION_DOMAIN,
    runId,
    String(graphRevision),
    panelNodeId,
    canonicalSerialize(without(document, "panelDecisionId")),
  ]);
}

function computeReflectionId(record) {
  return framedDigest([
    REFLECTION_DOMAIN,
    record.runId,
    record.nodeId,
    String(record.attempt),
    canonicalSerialize(without(record, "reflectionId")),
  ]);
}

// ---------------------------------------------------------------------------
// Section 8.2 — the panel's own threshold arithmetic.
//
// This function and `barrierSatisfaction` below are deliberately written twice
// from two different documents. They must agree on every corpus vector; if a
// future edit changes one alone, section 13.2's equivalence assertion fails.
// ---------------------------------------------------------------------------

function panelThreshold(threshold, counts) {
  const { total, succeeded, abstained } = counts;
  if (total === 0) return { satisfied: false, reasonCode: "NO_ITEMS" };
  if (threshold.kind === "all") {
    return succeeded === total
      ? { satisfied: true, reasonCode: "ALL_SUCCEEDED" }
      : { satisfied: false, reasonCode: "ALL_NOT_SUCCEEDED" };
  }
  if (threshold.kind === "minimum") {
    if (threshold.minimum > total) return { satisfied: false, reasonCode: "MINIMUM_EXCEEDS_TOTAL" };
    return succeeded >= threshold.minimum
      ? { satisfied: true, reasonCode: "MINIMUM_MET" }
      : { satisfied: false, reasonCode: "MINIMUM_NOT_MET" };
  }
  if (threshold.kind === "percentage") {
    return succeeded * 10000 >= total * threshold.basisPoints
      ? { satisfied: true, reasonCode: "PERCENTAGE_MET" }
      : { satisfied: false, reasonCode: "PERCENTAGE_NOT_MET" };
  }
  assert.equal(threshold.kind, "quorum", "unknown threshold kind");
  const participants = total - (threshold.countAbstainAsParticipant ? 0 : abstained);
  if (threshold.accepts > participants) {
    return { satisfied: false, reasonCode: "QUORUM_EXCEEDS_PARTICIPANTS" };
  }
  return succeeded >= threshold.accepts
    ? { satisfied: true, reasonCode: "QUORUM_MET" }
    : { satisfied: false, reasonCode: "QUORUM_NOT_MET" };
}

// Transcribed independently from integrated-barrier-semantics.md, "Satisfaction
// arithmetic". Its inputs are the six barrier disposition counts, never a panel
// object, so it cannot silently inherit a panel-side mistake.
function barrierSatisfaction(policy, dispositionCounts) {
  const total = ["succeeded", "failed", "missing", "timedOut", "abstained", "unknown"]
    .reduce((sum, key) => sum + dispositionCounts[key], 0);
  if (total === 0) return { satisfied: false, reasonCode: "NO_ITEMS" };
  switch (policy.kind) {
    case "all":
      return dispositionCounts.succeeded === total
        ? { satisfied: true, reasonCode: "ALL_SUCCEEDED" }
        : { satisfied: false, reasonCode: "ALL_NOT_SUCCEEDED" };
    case "minimum":
      if (policy.minimum > total) return { satisfied: false, reasonCode: "MINIMUM_EXCEEDS_TOTAL" };
      return dispositionCounts.succeeded >= policy.minimum
        ? { satisfied: true, reasonCode: "MINIMUM_MET" }
        : { satisfied: false, reasonCode: "MINIMUM_NOT_MET" };
    case "percentage":
      return dispositionCounts.succeeded * 10000 >= total * policy.basisPoints
        ? { satisfied: true, reasonCode: "PERCENTAGE_MET" }
        : { satisfied: false, reasonCode: "PERCENTAGE_NOT_MET" };
    case "quorum": {
      const participants = total
        - (policy.countAbstainAsParticipant ? 0 : dispositionCounts.abstained);
      if (policy.accepts > participants) {
        return { satisfied: false, reasonCode: "QUORUM_EXCEEDS_PARTICIPANTS" };
      }
      return dispositionCounts.succeeded >= policy.accepts
        ? { satisfied: true, reasonCode: "QUORUM_MET" }
        : { satisfied: false, reasonCode: "QUORUM_NOT_MET" };
    }
    default:
      throw new Error(`unknown barrier policy kind ${String(policy.kind)}`);
  }
}

function barrierPolicyOf(threshold) {
  // The barrier policy carrier for the same threshold, with the resolution
  // members a barrier requires. `unknown` is chosen because it is the only
  // barrier resolution that is neither a pass nor a node failure.
  return {
    apiVersion: BARRIER_CONTRACT_API_VERSION,
    kind: threshold.kind,
    ...(threshold.kind === "minimum" ? { minimum: threshold.minimum } : {}),
    ...(threshold.kind === "percentage" ? { basisPoints: threshold.basisPoints } : {}),
    ...(threshold.kind === "quorum"
      ? { quorum: { accepts: threshold.accepts, countAbstainAsParticipant: threshold.countAbstainAsParticipant } }
      : {}),
    onUnsatisfied: "unknown",
    lateArrival: "ignore",
  };
}

function computeBarrierPolicyHash(policy) {
  return framedDigest([BARRIER_POLICY_DOMAIN, "barrier", canonicalSerialize(policy)]);
}

// ---------------------------------------------------------------------------
// Guard registry.
// ---------------------------------------------------------------------------

const G = Object.freeze({
  // --- rubric -------------------------------------------------------------
  RUBRIC_HASH: guard("R001", "rubricHash recomputes from the framed digest"),
  RUBRIC_CRITERION_IDS_UNIQUE: guard("R002", "criterionId values are unique"),
  RUBRIC_COMPARISON_AGGREGATION: guard("R003", "comparison mode requires decision.aggregation"),
  RUBRIC_COMPARISON_TIEBREAK: guard("R004", "comparison mode requires decision.tieBreak"),
  RUBRIC_VERIFICATION_NO_AGGREGATION: guard("R005", "verification mode forbids decision.aggregation"),
  RUBRIC_VERIFICATION_NO_TIEBREAK: guard("R006", "verification mode forbids decision.tieBreak"),
  RUBRIC_CITATION_BICONDITIONAL: guard("R007", "citation policy present iff some criterion requires citation"),
  RUBRIC_DEPRECATION_NOTE: guard("R008", "deprecated true requires migrationNote"),
  RUBRIC_CAPABILITY_ORDER: guard("R009", "ceiling.capabilities in ascending code-point order"),
  RUBRIC_REFLECTION_REVISIONS: guard("R010", "reflection.maxRevisions within ceiling.maxRevisions"),
  RUBRIC_THRESHOLD_MINIMUM_CEILING: guard("R011", "threshold minimum within ceiling.maxVerifiers"),
  RUBRIC_THRESHOLD_ACCEPTS_CEILING: guard("R012", "threshold quorum accepts within ceiling.maxVerifiers"),
  RUBRIC_QUORUM_FLOOR_CEILING: guard("R013", "quorum.minimumCast within ceiling.maxVerifiers"),
  RUBRIC_SUPERSEDES_SELF: guard("R014", "supersedes must not name the rubric's own id@version"),
  RUBRIC_NETWORK_DISABLED: guard("R015", "no conformance rubric may enable bounded network verification"),
  RUBRIC_DETERMINISTIC_NO_REFUTATION: guard("R016", "a deterministic criterion has no uncertainty to default"),
  RUBRIC_LENS_FLOOR: guard("R017", "minimumDistinctLenses cannot exceed the eight-member lens vocabulary"),

  // --- ballot -------------------------------------------------------------
  VERDICT_HASH: guard("V001", "verdictHash recomputes from the framed digest"),
  VERDICT_ABSTAIN_REASON: guard("V002", "abstainReason present iff verdict is abstain"),
  VERDICT_ABSTAIN_NO_OUTCOMES: guard("V003", "criterionOutcomes absent iff verdict is abstain"),
  VERDICT_OUTCOME_COVERAGE: guard("V004", "criterionOutcomes cover the rubric criteria in declaration order"),
  VERDICT_PASS_NEEDS_SUPPORT: guard("V005", "a pass outcome requires supportEstablished"),
  VERDICT_MISSING_EVIDENCE_UNKNOWN: guard("V006", "required evidence absent forces outcome unknown"),
  VERDICT_REFUTATION_DEFAULT: guard("V007", "adversarial default forces outcome reject"),
  VERDICT_BASIS_MATCH: guard("V008", "outcome basis equals the criterion basis"),
  VERDICT_FINDING_CRITERION: guard("V009", "a finding names a declared criterion"),
  VERDICT_FINDING_SEVERITY: guard("V010", "a finding carries its criterion's severity"),
  VERDICT_OUTCOME_EVIDENCE_SUBSET: guard("V011", "outcome evidenceRefs are a subset of the ballot's"),
  VERDICT_FINDING_EVIDENCE_SUBSET: guard("V012", "finding evidenceRefs are a subset of the ballot's"),
  VERDICT_SCORES_BICONDITIONAL: guard("V013", "scores present iff the rubric mode is comparison"),
  VERDICT_NORMALIZATION: guard("V014", "normalizedBasisPoints recomputes by exact integer floor division"),
  VERDICT_SCALE_ORDER: guard("V015", "scaleMin is strictly below scaleMax"),
  VERDICT_RAW_IN_SCALE: guard("V016", "rawScore lies inside the declared scale"),
  VERDICT_SUBJECT_EVIDENCE: guard("V017", "the ballot cites the panel subject's original evidence hash"),
  VERDICT_RUBRIC_BINDING: guard("V018", "the ballot names the panel's rubric id and version"),

  // --- the five-rung fold -------------------------------------------------
  FOLD_BLOCKING_REJECT: guard("F001", "rung 1: a blocking reject yields reject"),
  FOLD_BLOCKING_UNKNOWN: guard("F002", "rung 2: a blocking unknown yields unknown"),
  FOLD_EVIDENCE_UNKNOWN: guard("F003", "rung 3: a required-evidence unknown yields unknown"),
  FOLD_MAJOR_REJECT: guard("F004", "rung 4: a major reject yields reject"),
  FOLD_OTHERWISE_PASS: guard("F005", "rung 5: otherwise pass"),

  // --- exclusion ----------------------------------------------------------
  EXCLUDE_IDENTITY: guard("X001", "maker/verifier identity collision is excluded"),
  EXCLUDE_SHARED_CONTEXT: guard("X002", "a shared maker/verifier context is excluded"),
  EXCLUDE_EVIDENCE: guard("X003", "a ballot reading the maker summary is excluded"),
  EXCLUDE_PROOF_ABSENT: guard("X004", "a missing required separation proof is excluded"),
  EXCLUDE_RUBRIC_HASH: guard("X005", "a ballot bound to another rubric hash is excluded"),
  EXCLUDE_CAPABILITY: guard("X006", "a seat outside the capability ceiling is excluded"),
  EXCLUDE_UNWARRANTED: guard("X007", "a seat with no exclusion condition must not be excluded"),
  EXCLUDE_CODE_BICONDITIONAL: guard("X008", "exclusionCode present iff participation is excluded"),
  EXCLUDE_VERDICT_INDEPENDENT: guard("X009", "exclusion is unchanged under every substituted ballot verdict"),

  // --- census -------------------------------------------------------------
  CENSUS_NOT_CAST_BICONDITIONAL: guard("C001", "verdict not-cast iff participation is not counted"),
  CENSUS_NOT_CAST_KEYS: guard("C002", "a not-cast record's key set is exactly the four or five permitted keys"),
  CENSUS_COUNTED_HAS_HASH: guard("C003", "a counted seat carries verdictHash"),
  CENSUS_HASH_MATCHES_BALLOT: guard("C004", "a counted seat's verdictHash is the retained ballot's"),
  CENSUS_SEAT_IDS_UNIQUE: guard("C005", "seat verifierId values are unique"),
  CENSUS_VERDICT_TALLY: guard("C006", "the five census verdict counts recompute from the seats"),
  CENSUS_PARTICIPATION_TALLY: guard("C007", "the four participation counts recompute from the seats"),
  CENSUS_VERDICT_SUM: guard("C008", "the five census verdict counts sum to the seat count"),
  CENSUS_PARTICIPATION_SUM: guard("C009", "the four participation counts sum to the seat count"),
  CENSUS_SEAT_VERDICT_MATCHES: guard("C010", "a counted seat's verdict is the ballot's verdict"),
  CENSUS_SEAT_CONFIDENCE: guard("C011", "a counted seat's confidence mirrors the ballot's"),
  CENSUS_SEAT_LENS: guard("C012", "a counted seat's lens is the ballot's lens"),
  CENSUS_CEILING: guard("C013", "the seat count is inside ceiling.maxVerifiers"),
  CENSUS_BALLOT_KNOWN: guard("C014", "every counted seat names a retained ballot"),

  // --- quorum, threshold, resolution --------------------------------------
  QUORUM_CAST_COUNT: guard("Q001", "castCount recomputes from the census and the counting rules"),
  QUORUM_DISTINCT_LENSES: guard("Q002", "distinctCountedLenses recomputes from the counted seats"),
  QUORUM_SATISFIED: guard("Q003", "quorum.satisfied recomputes from both floors"),
  QUORUM_POLICY_MIRROR: guard("Q004", "the decision mirrors the rubric's quorum policy"),
  QUORUM_LENS_FLOOR_MIRROR: guard("Q005", "the decision mirrors the rubric's lens floor"),
  THRESHOLD_MIRROR: guard("Q006", "the decision mirrors the rubric's threshold"),
  THRESHOLD_SATISFIED: guard("Q007", "thresholdSatisfied recomputes from the projected counts"),
  THRESHOLD_REASON_CODE: guard("Q008", "reasonCode recomputes from the projected counts"),
  REASON_CLASS_MAP: guard("Q009", "reasonClass is the frozen class of the reason code"),
  REASON_CLASS_CONSISTENT: guard("Q010", "thresholdSatisfied iff reasonClass is satisfied"),
  RESOLUTION_DERIVED: guard("Q011", "resolution recomputes from the two-stage rule"),
  TERMINAL_MAP: guard("Q012", "terminal is the frozen terminal of the resolution"),
  BINDS_OUTPUT: guard("Q013", "bindsOutput iff the resolution is pass"),
  PASS_INVARIANT: guard("Q014", "a pass implies a satisfied quorum, a satisfied class and a live rubric"),
  POST_TALLY_COLLISION_RESOLUTION: guard("Q015", "a post-tally collision degrades to the insufficient-quorum resolution"),
  POST_TALLY_COLLISION_RETAINED: guard("Q016", "a post-tally collision leaves the colliding ballot counted"),
  PANEL_MODE_MIRROR: guard("Q017", "the decision mirrors the rubric mode"),
  PANEL_RUBRIC_HASH: guard("Q018", "the decision carries the rubric's own hash"),
  PANEL_DECISION_ID: guard("Q019", "panelDecisionId recomputes from the framed five-part preimage"),

  // --- composition with the frozen barrier contract -----------------------
  BARRIER_DISPOSITION_MAP: guard("B001", "each seat projects to its frozen barrier disposition"),
  BARRIER_VOTE_RECORD_MAP: guard("B002", "each seat projects to its frozen vote-record verdict"),
  BARRIER_NOT_CAST_KEYS: guard("B003", "a projected not-cast record's key set is exactly sourceNodeId and verdict"),
  BARRIER_DECISION_SCHEMA_VALID: guard("B004", "the projected barrier decision satisfies the frozen barrier schema"),
  BARRIER_EQUIVALENT_SATISFIED: guard("B005", "the barrier's own arithmetic agrees on satisfaction"),
  BARRIER_EQUIVALENT_REASON: guard("B006", "the barrier's own arithmetic agrees on the reason code"),
  BARRIER_COUNT_PARTITION: guard("B007", "the six disposition counts sum to the seat count"),
  BARRIER_ID_PARTITION: guard("B008", "the six id lists partition the seats in census order"),
  BARRIER_VOTES_PRESENCE: guard("B009", "votes present iff the projected policy kind is quorum"),
  MODE_B_QUORUM_ONLY: guard("B010", "a delegated tally requires a quorum barrier"),
  MODE_B_THRESHOLD_MIRROR: guard("B011", "a delegated barrier mirrors the rubric threshold member for member"),
  MODE_B_NO_EXCLUSION: guard("B012", "a delegated tally requires a rubric that cannot exclude a seat"),
  MODE_B_VOTE_VALID: guard("B013", "a delegated ballot projects to a valid BarrierVote"),
  MODE_B_RAW_VERDICT_REFUSED: guard("B014", "a raw VerifierVerdict is not a valid BarrierVote"),
  MODE_A_VOTE_PROJECTION: guard("B015", "a panel resolution projects to its frozen barrier vote verdict"),
  PANEL_NEVER_DELEGATES: guard("B016", "a PanelDecision never claims a delegated tally"),

  // --- judge panels -------------------------------------------------------
  JUDGE_CANDIDATES_BICONDITIONAL: guard("J001", "candidates present iff the mode is comparison"),
  JUDGE_CANDIDATE_IDS_UNIQUE: guard("J002", "candidateId values are unique"),
  JUDGE_CANDIDATE_HASHES_DISTINCT: guard("J003", "candidate contentHash values are pairwise distinct"),
  JUDGE_SCORE_SET: guard("J004", "every counted ballot scores exactly the frozen candidate set in order"),
  JUDGE_AGGREGATION_MIRROR: guard("J005", "the decision mirrors the rubric aggregation"),
  JUDGE_SUM_AGGREGATE: guard("J006", "sum-of-normalized aggregates recompute"),
  JUDGE_BORDA_AGGREGATE: guard("J007", "borda-count aggregates recompute"),
  JUDGE_RANKING: guard("J008", "competition ranking recomputes"),
  JUDGE_LADDER_MIRROR: guard("J009", "the decision mirrors the rubric tie-break ladder"),
  JUDGE_UNRESOLVED_MIRROR: guard("J010", "the decision mirrors the rubric onUnresolved"),
  JUDGE_RESOLVED_RUNG: guard("J011", "resolvedAtRung recomputes"),
  JUDGE_LEADING_SET: guard("J012", "leadingCandidateIds recomputes"),
  JUDGE_RUNG_MIN: guard("J013", "the highest-minimum-score rung recomputes"),
  JUDGE_RUNG_MEDIAN: guard("J014", "the highest-median-score rung recomputes on doubled integers"),
  JUDGE_RUNG_FIRST_RANKS: guard("J015", "the most-first-ranks rung recomputes"),
  JUDGE_RUNG_BLOCKING: guard("J016", "the fewest-blocking-findings rung recomputes"),
  JUDGE_RUNG_DECLARED: guard("J017", "the earliest-declared-candidate rung recomputes"),
  JUDGE_RUNG_HASH: guard("J018", "the lowest-content-hash rung recomputes"),
  JUDGE_UNRESOLVED_NO_SELECTION: guard("J019", "an exhausted ladder selects nothing"),
  JUDGE_SELECTION_LEADER: guard("J020", "the selection names the single leading candidate"),
  JUDGE_SELECTION_ALL_CANDIDATES: guard("J021", "the selection records every candidate hash in declaration order"),
  JUDGE_SELECTION_ALL_VERDICTS: guard("J022", "the selection records every counted verdict hash in census order"),
  JUDGE_SYNTHESIS_PASS_ONLY: guard("J023", "synthesis is present only on a pass"),
  JUDGE_SYNTHESIS_CANDIDATE: guard("J024", "a graft names a declared candidate"),
  JUDGE_SYNTHESIS_CITED: guard("J025", "a graft names evidence retained by a counted ballot"),
  JUDGE_RANKING_BICONDITIONAL: guard("J026", "ranking present iff the mode is comparison"),
  JUDGE_RANKING_COVERAGE: guard("J027", "ranking covers exactly the candidates in declaration order"),
  JUDGE_UNRESOLVED_RESOLUTION: guard("J028", "an exhausted ladder resolves to onUnresolved"),

  // --- citation verification ----------------------------------------------
  CITATION_CLAIM_HASH: guard("T001", "claimHash recomputes from the framed digest"),
  CITATION_VERIFICATION_PAIRING: guard("T002", "verifications pair one-to-one with citations in order"),
  CITATION_DEFECT_SET: guard("T003", "the computed defect set equals the declared one"),
  CITATION_DEFECT_ORDER: guard("T004", "defects are emitted in vocabulary declaration order"),
  CITATION_OUTCOME_DERIVED: guard("T005", "outcome recomputes from the defect set"),
  CITATION_SUPPORT_MODE: guard("T006", "supportMode present iff the outcome is supported"),
  CITATION_SUPPORTED_NO_DEFECTS: guard("T007", "a supported outcome carries no defect"),
  CITATION_INACCESSIBLE_BICONDITIONAL: guard("T008", "inaccessible iff a resolution defect is present"),
  CITATION_CONTRADICTED_BICONDITIONAL: guard("T009", "contradicted iff CONTRADICTED_BY_SOURCE is present"),
  CITATION_EXISTENCE_NOT_SUPPORT: guard("T010", "a resolution defect never accompanies insufficient or contradicted"),
  CITATION_READ_ONLY_DEFECTS: guard("T011", "a read-derived defect never accompanies inaccessible"),
  CITATION_FABRICATION_IMPLIES_ABSENCE: guard("T012", "FABRICATED_LOCATOR never appears without SOURCE_NOT_FOUND"),
  CITATION_CIRCULAR_XOR_LAUNDERING: guard("T013", "a chain either revisits a source or terminates, never both"),
  CITATION_NO_NETWORK: guard("T014", "no verification used the network"),
  CITATION_EXTERNAL_DISCLOSURE: guard("T015", "a disabled-network url unreachability is disclosed as such"),
  CITATION_CRITERION_LADDER: guard("T016", "the criterion outcome recomputes from the citation outcomes"),
  CITATION_UNVERIFIED_PASS: guard("T017", "a criterion cannot pass on unsupported citations"),
  CITATION_IDS_UNIQUE: guard("T018", "citationId values are unique inside a claim"),

  // --- reflection ---------------------------------------------------------
  REFLECT_ID: guard("L001", "reflectionId recomputes from the framed five-part preimage"),
  REFLECT_NEVER_EDITS: guard("L002", "acceptedResultHash equals subjectHash"),
  REFLECT_PROPOSAL_BICONDITIONAL: guard("L003", "proposedResultHash present iff the verdict is reject"),
  REFLECT_PROPOSAL_DIFFERS: guard("L004", "a proposal differs from the subject it revises"),
  REFLECT_ATTEMPTS_CONTIGUOUS: guard("L005", "chain attempts are contiguous and strictly increasing from one"),
  REFLECT_CHAIN_LINK: guard("L006", "each successor reviews its predecessor's proposal"),
  REFLECT_RUBRIC_STABLE: guard("L007", "the rubric hash is identical across the chain"),
  REFLECT_LAST_STOPS: guard("L008", "exactly the last record of a chain stops"),
  REFLECT_STOP_REASON_BICONDITIONAL: guard("L009", "stopReason present iff stopped"),
  REFLECT_STOP_CONVERGED: guard("L010", "converged iff the verdict is pass"),
  REFLECT_STOP_REVISION_LIMIT: guard("L011", "revision-limit iff the revision budget is exhausted"),
  REFLECT_STOP_UNKNOWN: guard("L012", "unknown-evidence iff the verdict is unknown"),
  REFLECT_STOP_NO_PROGRESS: guard("L013", "no-progress iff the proposal revisits an earlier subject"),
  REFLECT_STOP_CEILING: guard("L014", "ceiling-exhausted iff the unit budget is exhausted"),
  REFLECT_STOP_CANCELLED: guard("L015", "cancelled iff the case declares a cancellation"),
  REFLECT_ATTEMPT_BOUND: guard("L016", "attempt never exceeds revisionsMax plus one"),
  REFLECT_REVISIONS_USED: guard("L017", "revisionsUsed equals attempt minus one"),
  REFLECT_UNITS_BOUND: guard("L018", "unitsUsed never exceeds unitsMax"),
  REFLECT_DETERMINISTIC_COVERAGE: guard("L019", "deterministicChecks cover exactly the deterministic criteria in order"),
  REFLECT_ISSUE_BASIS: guard("L020", "an issue's basis equals its criterion's basis"),
  REFLECT_ISSUE_ORDER: guard("L021", "issues follow rubric criterion declaration order"),
  REFLECT_MODEL_PERMISSIONS: guard("L022", "declared model and context permissions mirror the rubric"),
  REFLECT_NOT_ACCEPTED: guard("L023", "a chain that does not converge is not consumed as accepted"),

  // --- replay -------------------------------------------------------------
  REPLAY_OUTCOME: guard("P001", "the replay outcome recomputes from the seeded history"),
  REPLAY_DECISION_ID: guard("P002", "a seeded decision carries a recomputable identity"),
  REPLAY_ZERO_EXECUTOR: guard("P003", "an adopted decision costs zero executor calls"),
  REPLAY_ZERO_PROVIDER: guard("P004", "an adopted decision costs zero provider calls"),
  REPLAY_ZERO_APPEND: guard("P005", "an adopted decision appends no second decision event"),
  REPLAY_RUBRIC_DRIFT: guard("P006", "a drifted rubric hash is refused rather than re-judged"),
  REPLAY_IDENTITY_MISMATCH: guard("P007", "a transplanted decision identity is refused"),
  REPLAY_DUPLICATE: guard("P008", "two committed decisions for one node in one run are refused"),
  REPLAY_FORK_IDENTITY: guard("P009", "a fork never reuses the parent decision identity"),

  // --- corpus-level honesty ----------------------------------------------
  HEADER_IMPLEMENTATION_CLAIM: guard("H001", "implementationClaim is literally false"),
  HEADER_CLAIM_FLAGS: guard("H002", "every claim flag is literally false"),
  HEADER_NO_WALL_CLOCK: guard("H003", "no corpus member names a wall clock or a provider call"),
});

// ---------------------------------------------------------------------------
// Mutation vectors.
// ---------------------------------------------------------------------------

function pointerSegments(pointer) {
  assert.ok(pointer.startsWith("/"), `mutation pointer must start with '/': ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function applyMutation(root, mutation) {
  const segments = pointerSegments(mutation.path);
  const last = segments.pop();
  let cursor = root;
  for (const segment of segments) {
    cursor = Array.isArray(cursor) ? cursor[Number(segment)] : cursor[segment];
    assert.ok(cursor !== undefined, `mutation path does not resolve: ${mutation.path}`);
  }
  if (mutation.op === "set") {
    if (Array.isArray(cursor)) cursor[Number(last)] = clone(mutation.value);
    else cursor[last] = clone(mutation.value);
    return;
  }
  if (mutation.op === "delete") {
    if (Array.isArray(cursor)) cursor.splice(Number(last), 1);
    else delete cursor[last];
    return;
  }
  if (mutation.op === "insert") {
    assert.ok(Array.isArray(cursor), `insert requires an array parent: ${mutation.path}`);
    cursor.splice(last === "-" ? cursor.length : Number(last), 0, clone(mutation.value));
    return;
  }
  throw new Error(`unknown mutation op ${String(mutation.op)}`);
}

function applyMutations(value, mutations) {
  const copy = clone(value);
  for (const mutation of mutations) applyMutation(copy, mutation);
  return copy;
}

// ---------------------------------------------------------------------------
// Rubric checks.
// ---------------------------------------------------------------------------

function checkRubric(rubric) {
  check(G.RUBRIC_HASH, rubric.rubricHash === computeRubricHash(rubric),
    `rubric ${rubric.rubricId} hash drifted: expected ${computeRubricHash(rubric)}`);

  const ids = rubric.criteria.map((item) => item.criterionId);
  check(G.RUBRIC_CRITERION_IDS_UNIQUE, new Set(ids).size === ids.length,
    `rubric ${rubric.rubricId} repeats a criterionId`);

  const comparison = rubric.mode === "comparison";
  check(G.RUBRIC_COMPARISON_AGGREGATION, !comparison || Object.hasOwn(rubric.decision, "aggregation"),
    `comparison rubric ${rubric.rubricId} declares no aggregation`);
  check(G.RUBRIC_COMPARISON_TIEBREAK, !comparison || Object.hasOwn(rubric.decision, "tieBreak"),
    `comparison rubric ${rubric.rubricId} declares no tieBreak`);
  check(G.RUBRIC_VERIFICATION_NO_AGGREGATION, comparison || !Object.hasOwn(rubric.decision, "aggregation"),
    `verification rubric ${rubric.rubricId} declares an aggregation it can never apply`);
  check(G.RUBRIC_VERIFICATION_NO_TIEBREAK, comparison || !Object.hasOwn(rubric.decision, "tieBreak"),
    `verification rubric ${rubric.rubricId} declares a tieBreak but has nothing to rank`);

  const anyCitation = rubric.criteria.some((item) => item.citationRequired === true);
  check(G.RUBRIC_CITATION_BICONDITIONAL, anyCitation === Object.hasOwn(rubric, "citation"),
    `rubric ${rubric.rubricId} citation policy presence (${Object.hasOwn(rubric, "citation")}) `
    + `disagrees with its criteria (${anyCitation})`);

  check(G.RUBRIC_DEPRECATION_NOTE,
    rubric.deprecation.deprecated !== true || Object.hasOwn(rubric.deprecation, "migrationNote"),
    `deprecated rubric ${rubric.rubricId} carries no migrationNote`);

  const capabilities = rubric.ceiling.capabilities;
  check(G.RUBRIC_CAPABILITY_ORDER,
    deepEqual(capabilities, [...capabilities].sort(compareUnicodeCodePoints)),
    `rubric ${rubric.rubricId} capabilities are not in ascending code-point order`);

  check(G.RUBRIC_REFLECTION_REVISIONS,
    !Object.hasOwn(rubric, "reflection") || rubric.reflection.maxRevisions <= rubric.ceiling.maxRevisions,
    `rubric ${rubric.rubricId} reflection policy exceeds its own revision ceiling`);

  const threshold = rubric.decision.threshold;
  check(G.RUBRIC_THRESHOLD_MINIMUM_CEILING,
    threshold.kind !== "minimum" || threshold.minimum <= rubric.ceiling.maxVerifiers,
    `rubric ${rubric.rubricId} minimum ${threshold.minimum} exceeds maxVerifiers ${rubric.ceiling.maxVerifiers}`);
  check(G.RUBRIC_THRESHOLD_ACCEPTS_CEILING,
    threshold.kind !== "quorum" || threshold.accepts <= rubric.ceiling.maxVerifiers,
    `rubric ${rubric.rubricId} accepts ${threshold.accepts} exceeds maxVerifiers ${rubric.ceiling.maxVerifiers}`);
  check(G.RUBRIC_QUORUM_FLOOR_CEILING,
    rubric.decision.quorum.minimumCast <= rubric.ceiling.maxVerifiers,
    `rubric ${rubric.rubricId} minimumCast exceeds maxVerifiers ${rubric.ceiling.maxVerifiers}`);

  check(G.RUBRIC_SUPERSEDES_SELF,
    !Object.hasOwn(rubric.deprecation, "supersedes")
    || rubric.deprecation.supersedes !== `${rubric.rubricId}@${rubric.rubricVersion}`,
    `rubric ${rubric.rubricId} supersedes itself`);

  check(G.RUBRIC_NETWORK_DISABLED,
    !Object.hasOwn(rubric, "citation") || rubric.citation.networkVerification === "disabled",
    `rubric ${rubric.rubricId} enables bounded network verification inside conformance`);

  for (const criterion of rubric.criteria) {
    check(G.RUBRIC_DETERMINISTIC_NO_REFUTATION,
      criterion.basis !== "deterministic" || criterion.refutationDefault === false,
      `criterion ${criterion.criterionId} is deterministic yet declares a refutation default`);
  }

  check(G.RUBRIC_LENS_FLOOR, rubric.independence.minimumDistinctLenses <= LENSES.length,
    `rubric ${rubric.rubricId} requires more distinct lenses than the vocabulary holds`);
}

// ---------------------------------------------------------------------------
// Ballot checks and the five-rung fold.
// ---------------------------------------------------------------------------

const FOLD_RUNGS = Object.freeze([
  { guard: G.FOLD_BLOCKING_REJECT, verdict: "reject" },
  { guard: G.FOLD_BLOCKING_UNKNOWN, verdict: "unknown" },
  { guard: G.FOLD_EVIDENCE_UNKNOWN, verdict: "unknown" },
  { guard: G.FOLD_MAJOR_REJECT, verdict: "reject" },
  { guard: G.FOLD_OTHERWISE_PASS, verdict: "pass" },
]);

function foldBallot(rubric, outcomes) {
  const byId = new Map(rubric.criteria.map((item) => [item.criterionId, item]));
  const matches = (predicate) => outcomes.some((outcome) => predicate(byId.get(outcome.criterionId), outcome));

  if (matches((criterion, outcome) => criterion.severity === "blocking" && outcome.outcome === "reject")) {
    return { rung: 0, verdict: "reject" };
  }
  if (matches((criterion, outcome) => criterion.severity === "blocking" && outcome.outcome === "unknown")) {
    return { rung: 1, verdict: "unknown" };
  }
  if (matches((criterion, outcome) => criterion.evidenceRequired === true && outcome.outcome === "unknown")) {
    return { rung: 2, verdict: "unknown" };
  }
  if (matches((criterion, outcome) => criterion.severity === "major" && outcome.outcome === "reject")) {
    return { rung: 3, verdict: "reject" };
  }
  return { rung: 4, verdict: "pass" };
}

function checkVerdict(ballot, rubric, subject) {
  check(G.VERDICT_HASH, ballot.verdictHash === computeVerdictHash(ballot),
    `ballot ${ballot.verifierId} hash drifted: expected ${computeVerdictHash(ballot)}`);

  const abstained = ballot.verdict === "abstain";
  check(G.VERDICT_ABSTAIN_REASON, abstained === Object.hasOwn(ballot, "abstainReason"),
    `ballot ${ballot.verifierId} abstainReason presence disagrees with its verdict`);
  check(G.VERDICT_ABSTAIN_NO_OUTCOMES, abstained !== Object.hasOwn(ballot, "criterionOutcomes"),
    `ballot ${ballot.verifierId} criterionOutcomes presence disagrees with its verdict`);

  // The corpus names the rubric each ballot is filed against independently of
  // the ballot's own claim, so a ballot that misnames its rubric is visible.
  check(G.VERDICT_RUBRIC_BINDING,
    `${ballot.rubricId}@${ballot.rubricVersion}` === `${rubric.rubricId}@${rubric.rubricVersion}`,
    `ballot ${ballot.verifierId} names rubric ${ballot.rubricId}@${ballot.rubricVersion}, `
    + `but the corpus files it against ${rubric.rubricId}@${rubric.rubricVersion}`);

  if (subject !== null) {
    check(G.VERDICT_SUBJECT_EVIDENCE, ballot.subjectEvidenceHash === subject.evidenceHash,
      `ballot ${ballot.verifierId} did not read the subject's original evidence`);
  }

  const comparison = rubric.mode === "comparison";
  check(G.VERDICT_SCORES_BICONDITIONAL, comparison === Object.hasOwn(ballot, "scores"),
    `ballot ${ballot.verifierId} scores presence disagrees with rubric mode ${rubric.mode}`);

  const byId = new Map(rubric.criteria.map((item) => [item.criterionId, item]));
  for (const finding of ballot.findings) {
    check(G.VERDICT_FINDING_CRITERION, byId.has(finding.criterionId),
      `ballot ${ballot.verifierId} reports a finding on undeclared criterion ${finding.criterionId}`);
    check(G.VERDICT_FINDING_SEVERITY, finding.severity === byId.get(finding.criterionId).severity,
      `ballot ${ballot.verifierId} finding on ${finding.criterionId} carries severity ${finding.severity}, `
      + `not ${byId.get(finding.criterionId).severity}`);
    check(G.VERDICT_FINDING_EVIDENCE_SUBSET,
      finding.evidenceRefs.every((ref) => ballot.evidenceRefs.includes(ref)),
      `ballot ${ballot.verifierId} finding on ${finding.criterionId} cites evidence the ballot does not retain`);
  }

  if (Object.hasOwn(ballot, "scores")) {
    for (const score of ballot.scores) {
      check(G.VERDICT_SCALE_ORDER, score.scaleMin < score.scaleMax,
        `ballot ${ballot.verifierId} score for ${score.candidateId} declares an empty scale`);
      check(G.VERDICT_RAW_IN_SCALE,
        score.rawScore >= score.scaleMin && score.rawScore <= score.scaleMax,
        `ballot ${ballot.verifierId} rawScore ${score.rawScore} for ${score.candidateId} is outside its scale`);
      const expected = Math.floor(((score.rawScore - score.scaleMin) * 10000) / (score.scaleMax - score.scaleMin));
      check(G.VERDICT_NORMALIZATION, score.normalizedBasisPoints === expected,
        `ballot ${ballot.verifierId} normalized ${score.candidateId} to ${score.normalizedBasisPoints}, `
        + `exact integer division yields ${expected}`);
    }
  }

  if (abstained) return;

  const outcomes = ballot.criterionOutcomes;
  checkEqual(G.VERDICT_OUTCOME_COVERAGE,
    outcomes.map((item) => item.criterionId),
    rubric.criteria.map((item) => item.criterionId),
    `ballot ${ballot.verifierId} criterion outcomes do not cover the rubric in declaration order`);

  for (const outcome of outcomes) {
    const criterion = byId.get(outcome.criterionId);
    check(G.VERDICT_BASIS_MATCH, outcome.basis === criterion.basis,
      `ballot ${ballot.verifierId} answers ${criterion.basis} criterion ${outcome.criterionId} `
      + `on a ${outcome.basis} basis`);
    check(G.VERDICT_PASS_NEEDS_SUPPORT,
      outcome.outcome !== "pass" || outcome.supportEstablished === true,
      `ballot ${ballot.verifierId} passes ${outcome.criterionId} without establishing support`);
    check(G.VERDICT_MISSING_EVIDENCE_UNKNOWN,
      !(criterion.evidenceRequired === true && outcome.evidenceRefs.length === 0)
      || outcome.outcome === "unknown",
      `ballot ${ballot.verifierId} answered required-evidence criterion ${outcome.criterionId} `
      + `as ${outcome.outcome} with no evidence; missing required evidence must be unknown`);
    check(G.VERDICT_REFUTATION_DEFAULT,
      !(criterion.refutationDefault === true
        && outcome.evidenceRefs.length > 0
        && outcome.supportEstablished === false)
      || outcome.outcome === "reject",
      `ballot ${ballot.verifierId} answered ${outcome.criterionId} as ${outcome.outcome}; `
      + `the adversarial default requires reject when support was not established`);
    check(G.VERDICT_OUTCOME_EVIDENCE_SUBSET,
      outcome.evidenceRefs.every((ref) => ballot.evidenceRefs.includes(ref)),
      `ballot ${ballot.verifierId} outcome for ${outcome.criterionId} cites evidence the ballot does not retain`);
  }

  const folded = foldBallot(rubric, outcomes);
  check(FOLD_RUNGS[folded.rung].guard, ballot.verdict === folded.verdict,
    `ballot ${ballot.verifierId} declares ${ballot.verdict}; rung ${folded.rung + 1} of the fold yields `
    + `${folded.verdict}`);
  return folded.rung;
}

// ---------------------------------------------------------------------------
// Exclusion (section 6).
// ---------------------------------------------------------------------------

const EXCLUSION_GUARD_OF = Object.freeze({
  MAKER_VERIFIER_IDENTITY_COLLISION: G.EXCLUDE_IDENTITY,
  SHARED_CONTEXT_DENIED: G.EXCLUDE_SHARED_CONTEXT,
  EVIDENCE_NOT_ORIGINAL: G.EXCLUDE_EVIDENCE,
  SEPARATION_PROOF_ABSENT: G.EXCLUDE_PROOF_ABSENT,
  RUBRIC_HASH_MISMATCH: G.EXCLUDE_RUBRIC_HASH,
  CAPABILITY_DENIED: G.EXCLUDE_CAPABILITY,
});

/**
 * Decides exclusion. `provenance` deliberately *does* carry the ballot verdict,
 * so that section 6.1's verdict-independence property is a real property of
 * this function rather than a tautology of its signature: if a future edit ever
 * reads `provenance.verdict`, the substitution check below stops holding.
 */
function recomputeExclusion(rubric, subject, provenance) {
  const independence = rubric.independence;
  if (independence.sameIdentityPermitted === false && provenance.verifierId === subject.makerIdentity) {
    return "MAKER_VERIFIER_IDENTITY_COLLISION";
  }
  if (independence.separationProofRequired === true && provenance.separationProof === null) {
    return "SEPARATION_PROOF_ABSENT";
  }
  if (provenance.separationProof !== null) {
    if (independence.sharedContextPermitted === false
      && provenance.separationProof.makerContextHash === provenance.separationProof.verifierContextHash) {
      return "SHARED_CONTEXT_DENIED";
    }
    if (independence.evidenceSource === "original"
      && Object.hasOwn(subject, "makerSummaryHash")
      && provenance.separationProof.evidenceSourceHash === subject.makerSummaryHash) {
      return "EVIDENCE_NOT_ORIGINAL";
    }
  }
  if (provenance.rubricHash !== rubric.rubricHash) return "RUBRIC_HASH_MISMATCH";
  if (!provenance.capabilities.every((item) => rubric.ceiling.capabilities.includes(item))) {
    return "CAPABILITY_DENIED";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Panel evaluation (sections 7, 8, 13).
// ---------------------------------------------------------------------------

function projectSeat(seat) {
  const row = BARRIER_PROJECTION.find(
    (item) => item.participation === seat.participation && item.verdict === seat.verdict,
  );
  return row ?? null;
}

function checkPanel(testCase, context) {
  const { rubric, ballots, ajv } = context;
  const decision = testCase.decision;
  const label = `panelCases/${testCase.name}`;
  const seats = decision.seats;

  check(G.PANEL_MODE_MIRROR, decision.mode === rubric.mode,
    `${label} declares mode ${decision.mode}; the rubric is ${rubric.mode}`);
  check(G.PANEL_RUBRIC_HASH, decision.rubricHash === rubric.rubricHash,
    `${label} carries rubric hash ${decision.rubricHash}, not ${rubric.rubricHash}`);
  check(G.CENSUS_CEILING, seats.length <= rubric.ceiling.maxVerifiers,
    `${label} seats ${seats.length} exceed ceiling.maxVerifiers ${rubric.ceiling.maxVerifiers}`
    + " (PANEL_CEILING_EXCEEDED)");
  check(G.PANEL_NEVER_DELEGATES, !Object.hasOwn(decision, "tallyDelegatedToBarrier"),
    `${label} claims a delegated tally; a delegated tally emits no PanelDecision at all`);

  const seatIds = seats.map((item) => item.verifierId);
  check(G.CENSUS_SEAT_IDS_UNIQUE, new Set(seatIds).size === seatIds.length,
    `${label} repeats a seat verifierId`);

  // --- per-seat census rules ---------------------------------------------
  for (const seat of seats) {
    const seatLabel = `${label} seat ${seat.verifierId}`;
    const counted = seat.participation === "counted";
    check(G.CENSUS_NOT_CAST_BICONDITIONAL, (seat.verdict === NOT_CAST) === !counted,
      `${seatLabel} records verdict ${seat.verdict} with participation ${seat.participation}; `
      + "not-cast holds if and only if the seat is not counted");
    check(G.EXCLUDE_CODE_BICONDITIONAL,
      (seat.participation === "excluded") === Object.hasOwn(seat, "exclusionCode"),
      `${seatLabel} exclusionCode presence disagrees with participation ${seat.participation}`);

    if (seat.verdict === NOT_CAST) {
      const permitted = seat.participation === "excluded"
        ? [...NOT_CAST_SEAT_KEYS, "exclusionCode"]
        : [...NOT_CAST_SEAT_KEYS];
      checkEqual(G.CENSUS_NOT_CAST_KEYS,
        Object.keys(seat).sort(compareUnicodeCodePoints),
        [...permitted].sort(compareUnicodeCodePoints),
        `${seatLabel} not-cast key set materializes a ballot that was never cast`);
      continue;
    }

    check(G.CENSUS_COUNTED_HAS_HASH, Object.hasOwn(seat, "verdictHash"),
      `${seatLabel} is counted but the census cannot address the vote it counts`);
    check(G.CENSUS_BALLOT_KNOWN, ballots.has(seat.verdictHash),
      `${seatLabel} names a ballot ${seat.verdictHash} the corpus does not retain`);
    const ballot = ballots.get(seat.verdictHash);
    if (ballot === undefined) continue;
    check(G.CENSUS_HASH_MATCHES_BALLOT, ballot.verifierId === seat.verifierId,
      `${seatLabel} points at a ballot cast by ${ballot.verifierId}`);
    check(G.CENSUS_SEAT_VERDICT_MATCHES, ballot.verdict === seat.verdict,
      `${seatLabel} records ${seat.verdict}; the retained ballot says ${ballot.verdict}`);
    check(G.CENSUS_SEAT_LENS, ballot.lens === seat.lens,
      `${seatLabel} records lens ${seat.lens}; the retained ballot says ${ballot.lens}`);
    checkEqual(G.CENSUS_SEAT_CONFIDENCE,
      Object.hasOwn(seat, "confidenceBasisPoints") ? seat.confidenceBasisPoints : null,
      Object.hasOwn(ballot, "confidenceBasisPoints") ? ballot.confidenceBasisPoints : null,
      `${seatLabel} confidence does not mirror the retained ballot`);
  }

  // --- exclusion ----------------------------------------------------------
  for (const seat of seats) {
    if (!Object.hasOwn(testCase.provenance ?? {}, seat.verifierId)) continue;
    const provenanceInput = testCase.provenance[seat.verifierId];
    const provenanceFor = (verdict) => Object.freeze({
      verifierId: seat.verifierId,
      lens: seat.lens,
      rubricHash: provenanceInput.rubricHash,
      separationProof: provenanceInput.separationProof ?? null,
      capabilities: provenanceInput.capabilities,
      // Deliberately visible so that reading it can be detected.
      verdict,
      findings: provenanceInput.findings ?? [],
      confidenceBasisPoints: provenanceInput.confidenceBasisPoints ?? 1,
    });
    const expected = recomputeExclusion(rubric, decision.subject, provenanceFor(provenanceInput.verdict));
    const declared = Object.hasOwn(seat, "exclusionCode") ? seat.exclusionCode : null;
    if (expected === null) {
      check(G.EXCLUDE_UNWARRANTED, declared === null,
        `${label} seat ${seat.verifierId} is excluded as ${declared} with no exclusion condition present`);
    } else {
      check(EXCLUSION_GUARD_OF[expected], declared === expected,
        `${label} seat ${seat.verifierId} records ${declared ?? "no exclusion"}; provenance yields ${expected}`);
    }

    // Section 6.1: the same provenance under every substituted ballot verdict.
    const substituted = new Set(
      BALLOT_VERDICTS.map((verdict) => recomputeExclusion(rubric, decision.subject, provenanceFor(verdict))),
    );
    check(G.EXCLUDE_VERDICT_INDEPENDENT, substituted.size === 1 && substituted.has(expected),
      `${label} seat ${seat.verifierId} exclusion changed when the ballot verdict was substituted: `
      + `saw ${stable([...substituted])}`);
  }

  // --- tally --------------------------------------------------------------
  const countedSeats = seats.filter((item) => item.participation === "counted");
  const recomputedVerdictTally = {
    pass: countBy(seats, (item) => item.verdict === "pass"),
    reject: countBy(seats, (item) => item.verdict === "reject"),
    abstain: countBy(seats, (item) => item.verdict === "abstain"),
    unknown: countBy(seats, (item) => item.verdict === "unknown"),
    notCast: countBy(seats, (item) => item.verdict === NOT_CAST),
  };
  const recomputedParticipationTally = {
    counted: countedSeats.length,
    excluded: countBy(seats, (item) => item.participation === "excluded"),
    missing: countBy(seats, (item) => item.participation === "missing"),
    timedOut: countBy(seats, (item) => item.participation === "timed_out"),
  };
  // The sum rules are evaluated before the recomputation rules on purpose: a
  // tally pinned to the census can never fail to sum, so checking the sums
  // second would make them unfalsifiable.
  const verdictSum = CENSUS_VERDICTS
    .map((name) => (name === NOT_CAST ? "notCast" : name))
    .reduce((sum, key) => sum + decision.tally[key], 0);
  check(G.CENSUS_VERDICT_SUM, verdictSum === seats.length,
    `${label} five census verdict counts sum to ${verdictSum}, not ${seats.length}`);
  const participationSum = ["counted", "excluded", "missing", "timedOut"]
    .reduce((sum, key) => sum + decision.tally[key], 0);
  check(G.CENSUS_PARTICIPATION_SUM, participationSum === seats.length,
    `${label} four participation counts sum to ${participationSum}, not ${seats.length}`);
  checkEqual(G.CENSUS_VERDICT_TALLY,
    { pass: decision.tally.pass, reject: decision.tally.reject, abstain: decision.tally.abstain,
      unknown: decision.tally.unknown, notCast: decision.tally.notCast },
    recomputedVerdictTally,
    `${label} verdict tally disagrees with its own census (PANEL_CENSUS_INCOMPLETE)`);
  checkEqual(G.CENSUS_PARTICIPATION_TALLY,
    { counted: decision.tally.counted, excluded: decision.tally.excluded,
      missing: decision.tally.missing, timedOut: decision.tally.timedOut },
    recomputedParticipationTally,
    `${label} participation tally disagrees with its own census (PANEL_CENSUS_INCOMPLETE)`);

  // --- stage 1 ------------------------------------------------------------
  const quorumPolicy = rubric.decision.quorum;
  checkEqual(G.QUORUM_POLICY_MIRROR,
    { minimumCast: decision.quorum.minimumCast,
      countAbstainAsCast: decision.quorum.countAbstainAsCast,
      countUnknownAsCast: decision.quorum.countUnknownAsCast },
    { minimumCast: quorumPolicy.minimumCast,
      countAbstainAsCast: quorumPolicy.countAbstainAsCast,
      countUnknownAsCast: quorumPolicy.countUnknownAsCast },
    `${label} quorum policy does not mirror the rubric`);
  check(G.QUORUM_LENS_FLOOR_MIRROR,
    decision.quorum.minimumDistinctLenses === rubric.independence.minimumDistinctLenses,
    `${label} lens floor ${decision.quorum.minimumDistinctLenses} does not mirror the rubric's `
    + `${rubric.independence.minimumDistinctLenses}`);

  const castCount = countBy(countedSeats, (item) => item.verdict === "pass" || item.verdict === "reject")
    + (quorumPolicy.countAbstainAsCast ? countBy(countedSeats, (item) => item.verdict === "abstain") : 0)
    + (quorumPolicy.countUnknownAsCast ? countBy(countedSeats, (item) => item.verdict === "unknown") : 0);
  check(G.QUORUM_CAST_COUNT, decision.quorum.castCount === castCount,
    `${label} castCount ${decision.quorum.castCount} disagrees with the recomputed ${castCount}`);

  const distinctLenses = new Set(countedSeats.map((item) => item.lens)).size;
  check(G.QUORUM_DISTINCT_LENSES, decision.quorum.distinctCountedLenses === distinctLenses,
    `${label} distinctCountedLenses ${decision.quorum.distinctCountedLenses} disagrees with the `
    + `recomputed ${distinctLenses}`);

  const quorumSatisfied = castCount >= quorumPolicy.minimumCast
    && distinctLenses >= rubric.independence.minimumDistinctLenses;
  check(G.QUORUM_SATISFIED, decision.quorum.satisfied === quorumSatisfied,
    `${label} quorum.satisfied ${decision.quorum.satisfied} disagrees with the recomputed ${quorumSatisfied}`);

  // --- stage 2 ------------------------------------------------------------
  checkEqual(G.THRESHOLD_MIRROR, decision.threshold, rubric.decision.threshold,
    `${label} threshold does not mirror the rubric`);

  // Section 13.1/13.2. The corpus declares the projection it expects, so every
  // rule below compares two independently authored things rather than an
  // internal value against itself.
  const declaredBarrier = testCase.barrier;
  const dispositions = [];
  for (const seat of seats) {
    const row = projectSeat(seat);
    assert.ok(row !== null,
      `${label} seat ${seat.verifierId} (${seat.participation}/${seat.verdict}) escaped the census rules `
      + "and is outside the frozen seven-row barrier projection");
    dispositions.push({ seat, row });
  }
  checkEqual(G.BARRIER_DISPOSITION_MAP,
    declaredBarrier.dispositions, dispositions.map(({ row }) => row.disposition),
    `${label} declared barrier dispositions drifted from the frozen seat projection`);

  const dispositionCounts = {
    succeeded: 0, failed: 0, missing: 0, timedOut: 0, abstained: 0, unknown: 0,
  };
  const idLists = {
    acceptedIds: [], failedIds: [], missingIds: [], timedOutIds: [], abstainedIds: [], unknownIds: [],
  };
  for (const { seat, row } of dispositions) {
    dispositionCounts[DISPOSITION_TO_COUNT[row.disposition]] += 1;
    idLists[DISPOSITION_TO_ID_LIST[row.disposition]].push(seat.verifierId);
  }
  const dispositionSum = Object.values(declaredBarrier.counts).reduce((sum, value) => sum + value, 0);
  check(G.BARRIER_COUNT_PARTITION,
    deepEqual(declaredBarrier.counts, dispositionCounts) && dispositionSum === seats.length,
    `${label} declared barrier counts ${stable(declaredBarrier.counts)} drifted from the projected census `
    + `${stable(dispositionCounts)} or fail to sum to ${seats.length}`);
  const partitioned = Object.values(declaredBarrier.idLists).flat();
  check(G.BARRIER_ID_PARTITION,
    deepEqual(declaredBarrier.idLists, idLists)
    && partitioned.length === seats.length && new Set(partitioned).size === seats.length,
    `${label} declared barrier id lists do not partition the census in census order`);

  const counts = {
    total: seats.length,
    succeeded: dispositionCounts.succeeded,
    abstained: dispositionCounts.abstained,
  };
  const panelOutcome = panelThreshold(rubric.decision.threshold, counts);
  check(G.THRESHOLD_SATISFIED, decision.thresholdSatisfied === panelOutcome.satisfied,
    `${label} thresholdSatisfied ${decision.thresholdSatisfied} disagrees with the recomputed `
    + `${panelOutcome.satisfied}`);
  check(G.THRESHOLD_REASON_CODE, decision.reasonCode === panelOutcome.reasonCode,
    `${label} reasonCode ${decision.reasonCode} disagrees with the recomputed ${panelOutcome.reasonCode}`);

  // Section 13.2: the barrier's own arithmetic, transcribed independently.
  const policy = barrierPolicyOf(rubric.decision.threshold);
  const barrierPolicyBody = policy.kind === "quorum"
    ? { kind: "quorum", accepts: policy.quorum.accepts, countAbstainAsParticipant: policy.quorum.countAbstainAsParticipant }
    : policy;
  const barrierOutcome = barrierSatisfaction(barrierPolicyBody, dispositionCounts);
  // The two contracts must reach the same answer for the same census, and the
  // corpus must have said so independently. All three are one guard so that a
  // neutralized guard cannot leak into a bare assertion.
  check(G.BARRIER_EQUIVALENT_SATISFIED,
    barrierOutcome.satisfied === declaredBarrier.satisfied
    && declaredBarrier.satisfied === decision.thresholdSatisfied,
    `${label} the integrated barrier's own arithmetic yields satisfied=${barrierOutcome.satisfied}, the `
    + `corpus declares ${declaredBarrier.satisfied} and the panel claims ${decision.thresholdSatisfied}`);
  check(G.BARRIER_EQUIVALENT_REASON,
    barrierOutcome.reasonCode === declaredBarrier.reasonCode
    && declaredBarrier.reasonCode === decision.reasonCode,
    `${label} the integrated barrier's own arithmetic yields ${barrierOutcome.reasonCode}, the corpus `
    + `declares ${declaredBarrier.reasonCode} and the panel claims ${decision.reasonCode}`);

  const reasonClass = REASON_CLASS_OF[decision.reasonCode];
  check(G.REASON_CLASS_MAP, decision.reasonClass === reasonClass,
    `${label} reasonClass ${decision.reasonClass} is not the frozen class ${reasonClass} of `
    + `${decision.reasonCode}`);
  check(G.REASON_CLASS_CONSISTENT, decision.thresholdSatisfied === (reasonClass === "satisfied"),
    `${label} thresholdSatisfied ${decision.thresholdSatisfied} disagrees with reason class ${reasonClass}`);

  // --- resolution ---------------------------------------------------------
  const undecidable = quorumSatisfied === false
    || reasonClass === "insufficient"
    || decision.postTallyCollision === true;
  const expectedResolution = undecidable
    ? rubric.decision.onInsufficientQuorum
    : (panelOutcome.satisfied === false
      ? rubric.decision.onThresholdUnsatisfied
      : (rubric.deprecation.deprecated === true ? rubric.decision.onInsufficientQuorum : "pass"));
  // The central safety invariant is checked *before* the derivation rule, so
  // that neutralizing it alone is observable: a derivation-pinned resolution
  // can never violate it, but a mutated one can.
  check(G.PASS_INVARIANT,
    decision.resolution !== "pass"
    || (decision.quorum.satisfied === true
      && decision.reasonClass === "satisfied"
      && decision.postTallyCollision === false
      && rubric.deprecation.deprecated === false),
    `${label} resolved pass with quorum=${decision.quorum.satisfied}, class=${decision.reasonClass}, `
    + `collision=${decision.postTallyCollision}, deprecated=${rubric.deprecation.deprecated}`);

  if (decision.postTallyCollision === true) {
    check(G.POST_TALLY_COLLISION_RESOLUTION, decision.resolution === rubric.decision.onInsufficientQuorum,
      `${label} discovered a post-tally collision yet resolved ${decision.resolution}`);
    check(G.POST_TALLY_COLLISION_RETAINED,
      countedSeats.some((item) => item.verifierId === decision.subject.makerIdentity),
      `${label} declares a post-tally collision but no colliding ballot remains counted; `
      + "removing it would let a panel improve its own tally after seeing it");
  }

  const tieResolution = testCase.tieOverridesResolution === true ? decision.resolution : expectedResolution;
  check(G.RESOLUTION_DERIVED, decision.resolution === tieResolution,
    `${label} resolution ${decision.resolution} disagrees with the two-stage rule ${expectedResolution}`);
  check(G.TERMINAL_MAP, decision.terminal === TERMINAL_OF[decision.resolution],
    `${label} terminal ${decision.terminal} is not the frozen terminal of ${decision.resolution}`);
  check(G.BINDS_OUTPUT, decision.bindsOutput === (decision.resolution === "pass"),
    `${label} bindsOutput ${decision.bindsOutput} with resolution ${decision.resolution}; only a pass binds`);

  // --- identity -----------------------------------------------------------
  check(G.PANEL_DECISION_ID, decision.panelDecisionId === computePanelDecisionId(decision),
    `${label} panelDecisionId drifted: expected ${computePanelDecisionId(decision)}`);

  // --- projected barrier decision -----------------------------------------
  checkEqual(G.BARRIER_VOTE_RECORD_MAP,
    declaredBarrier.voteRecordVerdicts,
    dispositions.map(({ seat, row }) => {
      assert.equal(
        row.voteRecordVerdict,
        seat.verdict === NOT_CAST ? NOT_CAST : BALLOT_TO_BARRIER_VERDICT[seat.verdict],
        `${label} the frozen projection table disagrees with the ballot-to-barrier bijection`,
      );
      return row.voteRecordVerdict;
    }),
    `${label} declared vote-record verdicts drifted from the frozen ballot-to-barrier projection`);

  const votes = dispositions.map(({ seat, row }) => {
    const record = { sourceNodeId: seat.verifierId, verdict: row.voteRecordVerdict };
    if (row.voteRecordVerdict !== NOT_CAST && Object.hasOwn(seat, "confidenceBasisPoints")) {
      record.confidenceBasisPoints = seat.confidenceBasisPoints;
    }
    if (row.voteRecordVerdict === NOT_CAST) {
      checkEqual(G.BARRIER_NOT_CAST_KEYS,
        declaredBarrier.notCastRecordKeys,
        Object.keys(record).sort(compareUnicodeCodePoints),
        `${label} projected not-cast record for ${seat.verifierId} invents a ballot`);
    }
    return record;
  });

  const isQuorum = rubric.decision.threshold.kind === "quorum";
  const projected = {
    barrierNodeId: decision.panelNodeId,
    policyHash: computeBarrierPolicyHash(policy),
    decisionId: "0".repeat(64),
    armedAtMs: testCase.projection.armedAtMs,
    decidedAtMs: testCase.projection.decidedAtMs,
    deadlineElapsed: false,
    satisfied: barrierOutcome.satisfied,
    reasonCode: barrierOutcome.reasonCode,
    resolution: barrierOutcome.satisfied ? "satisfied" : "unknown",
    total: seats.length,
    ...dispositionCounts,
    ...idLists,
    ...(isQuorum ? { votes } : {}),
  };
  projected.decisionId = framedDigest([
    BARRIER_DECISION_DOMAIN,
    decision.runId,
    String(decision.graphRevision),
    decision.panelNodeId,
    canonicalSerialize(without(projected, "decisionId")),
  ]);
  check(G.BARRIER_VOTES_PRESENCE, declaredBarrier.votesPresent === isQuorum,
    `${label} declared votesPresent ${declaredBarrier.votesPresent} disagrees with the projected policy `
    + `kind ${rubric.decision.threshold.kind}; votes are present if and only if the policy is quorum`);
  const validBarrier = context.validateBarrierDecision(projected);
  check(G.BARRIER_DECISION_SCHEMA_VALID, validBarrier === true,
    `${label} projection is rejected by the frozen barrier decision schema: `
    + JSON.stringify(context.validateBarrierDecision.errors));

  // Section 13.5, Mode A: the panel's single outward vote.
  if (Object.hasOwn(testCase, "expectPanelVote")) {
    const expectedVote = decision.resolution === "human"
      ? null
      : BALLOT_TO_BARRIER_VERDICT[decision.resolution];
    checkEqual(G.MODE_A_VOTE_PROJECTION, testCase.expectPanelVote, expectedVote,
      `${label} panel vote projection`);
  }

  return {
    reasonCode: decision.reasonCode,
    reasonClass: decision.reasonClass,
    resolution: decision.resolution,
    terminal: decision.terminal,
    dispositionCounts,
  };
}

// ---------------------------------------------------------------------------
// Judge panels (section 9).
// ---------------------------------------------------------------------------

function competitionRanks(normalizedByCandidate, order) {
  return order.map((candidateId) => 1 + order.filter(
    (other) => normalizedByCandidate.get(other) > normalizedByCandidate.get(candidateId),
  ).length);
}

function doubledMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? 2 * sorted[middle] : sorted[middle - 1] + sorted[middle];
}

function applyRung(rung, leaders, judgeData) {
  const score = (candidateId) => {
    switch (rung) {
      case "highest-minimum-score":
        return Math.min(...judgeData.normalized.get(candidateId));
      case "highest-median-score":
        return doubledMedian(judgeData.normalized.get(candidateId));
      case "most-first-ranks":
        return judgeData.firstRanks.get(candidateId);
      case "fewest-blocking-findings":
        return -judgeData.blockingFindings.get(candidateId);
      case "earliest-declared-candidate":
        return -judgeData.declarationIndex.get(candidateId);
      case "lowest-content-hash":
        return null;
      default:
        throw new Error(`unknown tie-break rung ${String(rung)}`);
    }
  };
  if (rung === "lowest-content-hash") {
    const best = [...leaders].sort(
      (left, right) => compareUnicodeCodePoints(judgeData.contentHash.get(left), judgeData.contentHash.get(right)),
    )[0];
    return leaders.filter((item) => judgeData.contentHash.get(item) === judgeData.contentHash.get(best));
  }
  const best = Math.max(...leaders.map(score));
  return leaders.filter((item) => score(item) === best);
}

const RUNG_GUARD_OF = Object.freeze({
  "highest-minimum-score": G.JUDGE_RUNG_MIN,
  "highest-median-score": G.JUDGE_RUNG_MEDIAN,
  "most-first-ranks": G.JUDGE_RUNG_FIRST_RANKS,
  "fewest-blocking-findings": G.JUDGE_RUNG_BLOCKING,
  "earliest-declared-candidate": G.JUDGE_RUNG_DECLARED,
  "lowest-content-hash": G.JUDGE_RUNG_HASH,
});

function checkJudgePanel(testCase, context) {
  const { rubric, ballots } = context;
  const decision = testCase.decision;
  const label = `judgeCases/${testCase.name}`;
  const comparison = rubric.mode === "comparison";

  check(G.JUDGE_CANDIDATES_BICONDITIONAL, Object.hasOwn(decision, "candidates") === comparison,
    `${label} candidates presence disagrees with rubric mode ${rubric.mode}`);
  check(G.JUDGE_RANKING_BICONDITIONAL, Object.hasOwn(decision, "ranking") === comparison,
    `${label} ranking presence disagrees with rubric mode ${rubric.mode}`);
  if (!comparison) return null;
  // A neutralized presence guard must not turn into a crash further down.
  if (!Object.hasOwn(decision, "candidates") || !Object.hasOwn(decision, "ranking")) return null;
  if (!Object.hasOwn(rubric.decision, "tieBreak") || !Object.hasOwn(rubric.decision, "aggregation")) return null;

  const candidates = decision.candidates;
  const order = candidates.map((item) => item.candidateId);
  check(G.JUDGE_CANDIDATE_IDS_UNIQUE, new Set(order).size === order.length,
    `${label} repeats a candidateId`);
  const hashes = candidates.map((item) => item.contentHash);
  check(G.JUDGE_CANDIDATE_HASHES_DISTINCT, new Set(hashes).size === hashes.length,
    `${label} candidates were not frozen distinctly before judging`);

  const countedSeats = decision.seats.filter((item) => item.participation === "counted");
  const countedBallots = countedSeats
    .map((seat) => ballots.get(seat.verdictHash))
    .filter((item) => item !== undefined && Object.hasOwn(item, "scores"));

  const normalized = new Map(order.map((id) => [id, []]));
  const firstRanks = new Map(order.map((id) => [id, 0]));
  const blockingFindings = new Map(order.map((id) => [id, 0]));
  for (const ballot of countedBallots) {
    checkEqual(G.JUDGE_SCORE_SET, ballot.scores.map((item) => item.candidateId), order,
      `${label} ballot ${ballot.verifierId} does not score the frozen candidate set in declaration order `
      + "(CANDIDATE_SET_MUTATED)");
    if (!deepEqual(ballot.scores.map((item) => item.candidateId), order)) continue;
    const byCandidate = new Map(ballot.scores.map((item) => [item.candidateId, item.normalizedBasisPoints]));
    for (const id of order) normalized.get(id).push(byCandidate.get(id));
    const ranks = competitionRanks(byCandidate, order);
    order.forEach((id, index) => {
      if (ranks[index] === 1) firstRanks.set(id, firstRanks.get(id) + 1);
    });
    for (const finding of ballot.findings) {
      if (finding.severity !== "blocking") continue;
      for (const id of order) {
        if (finding.evidenceRefs.includes(`evidence.${id}`)) {
          blockingFindings.set(id, blockingFindings.get(id) + 1);
        }
      }
    }
  }

  check(G.JUDGE_AGGREGATION_MIRROR, decision.aggregation === rubric.decision.aggregation,
    `${label} aggregation ${decision.aggregation} does not mirror the rubric`);

  const aggregate = new Map();
  if (decision.aggregation === "sum-of-normalized") {
    for (const id of order) aggregate.set(id, normalized.get(id).reduce((sum, value) => sum + value, 0));
  } else {
    for (const id of order) aggregate.set(id, 0);
    for (const ballot of countedBallots) {
      const byCandidate = new Map(ballot.scores.map((item) => [item.candidateId, item.normalizedBasisPoints]));
      const ranks = competitionRanks(byCandidate, order);
      order.forEach((id, index) => aggregate.set(id, aggregate.get(id) + (order.length - ranks[index])));
    }
  }
  // Coverage is checked before the aggregate values so that a reordered ranking
  // reports the ordering rule rather than the arithmetic one.
  checkEqual(G.JUDGE_RANKING_COVERAGE, decision.ranking.map((item) => item.candidateId), order,
    `${label} ranking does not cover the frozen candidates in declaration order`);
  const aggregateGuard = decision.aggregation === "sum-of-normalized"
    ? G.JUDGE_SUM_AGGREGATE
    : G.JUDGE_BORDA_AGGREGATE;
  checkEqual(aggregateGuard,
    decision.ranking.map((item) => item.aggregateScore),
    order.map((id) => aggregate.get(id)),
    `${label} ${decision.aggregation} aggregate scores drifted`);

  const expectedRanks = competitionRanks(aggregate, order);
  checkEqual(G.JUDGE_RANKING, decision.ranking.map((item) => item.rank), expectedRanks,
    `${label} competition ranking drifted`);

  const judgeData = {
    normalized,
    firstRanks,
    blockingFindings,
    declarationIndex: new Map(order.map((id, index) => [id, index])),
    contentHash: new Map(candidates.map((item) => [item.candidateId, item.contentHash])),
  };

  checkEqual(G.JUDGE_LADDER_MIRROR, decision.tieBreak.ladder, rubric.decision.tieBreak.ladder,
    `${label} tie-break ladder does not mirror the rubric`);
  check(G.JUDGE_UNRESOLVED_MIRROR, decision.tieBreak.onUnresolved === rubric.decision.tieBreak.onUnresolved,
    `${label} onUnresolved does not mirror the rubric`);

  const bestAggregate = Math.max(...order.map((id) => aggregate.get(id)));
  let leaders = order.filter((id) => aggregate.get(id) === bestAggregate);
  let resolvedAtRung = null;
  const rungTrace = [];
  if (leaders.length > 1) {
    for (const rung of decision.tieBreak.ladder) {
      leaders = applyRung(rung, leaders, judgeData);
      rungTrace.push({ rung, leadingCandidateIds: [...leaders] });
      if (leaders.length === 1) {
        resolvedAtRung = rung;
        break;
      }
    }
  }

  for (const [index, entry] of rungTrace.entries()) {
    const declared = testCase.rungTrace[index];
    check(RUNG_GUARD_OF[entry.rung],
      declared !== undefined
      && declared.rung === entry.rung
      && deepEqual(declared.leadingCandidateIds, entry.leadingCandidateIds),
      `${label} rung ${entry.rung} yields ${stable(entry.leadingCandidateIds)}, corpus declares `
      + `${stable(declared?.leadingCandidateIds)}`);
  }
  checkEqual(G.JUDGE_LEADING_SET, decision.tieBreak.leadingCandidateIds, leaders,
    `${label} leadingCandidateIds drifted`);
  checkEqual(G.JUDGE_RESOLVED_RUNG, decision.tieBreak.resolvedAtRung, resolvedAtRung,
    `${label} resolvedAtRung drifted`);

  const unresolved = leaders.length > 1;
  check(G.JUDGE_UNRESOLVED_NO_SELECTION, unresolved !== Object.hasOwn(decision, "selection"),
    `${label} an exhausted ladder is not a pick; selection presence disagrees with the tie state`);
  if (unresolved) {
    check(G.JUDGE_UNRESOLVED_RESOLUTION, decision.resolution === rubric.decision.tieBreak.onUnresolved,
      `${label} an unresolved tie resolved ${decision.resolution}, not ${rubric.decision.tieBreak.onUnresolved}`);
  } else {
    check(G.JUDGE_SELECTION_LEADER, decision.selection.candidateId === leaders[0],
      `${label} selection names ${decision.selection.candidateId}, the ladder leaves ${leaders[0]}`);
    checkEqual(G.JUDGE_SELECTION_ALL_CANDIDATES, decision.selection.candidateHashes, hashes,
      `${label} the selection dropped a runner-up hash (PANEL_CENSUS_INCOMPLETE)`);
    checkEqual(G.JUDGE_SELECTION_ALL_VERDICTS,
      decision.selection.verdictHashes,
      countedSeats.map((item) => item.verdictHash),
      `${label} the selection dropped a counted ballot hash (PANEL_CENSUS_INCOMPLETE)`);
  }

  check(G.JUDGE_SYNTHESIS_PASS_ONLY,
    !Object.hasOwn(decision, "synthesis") || decision.resolution === "pass",
    `${label} carries a synthesis with resolution ${decision.resolution}`);
  if (Object.hasOwn(decision, "synthesis")) {
    const retained = new Set(countedBallots.flatMap((ballot) => ballot.evidenceRefs));
    for (const graft of decision.synthesis.grafts) {
      check(G.JUDGE_SYNTHESIS_CANDIDATE, order.includes(graft.fromCandidateId),
        `${label} grafts from undeclared candidate ${graft.fromCandidateId}`);
      check(G.JUDGE_SYNTHESIS_CITED, retained.has(graft.evidenceRef),
        `${label} grafts ${graft.evidenceRef}, which no counted ballot retains (SYNTHESIS_UNCITED)`);
    }
  }

  return { resolvedAtRung, aggregation: decision.aggregation, rungs: rungTrace.map((item) => item.rung) };
}

// ---------------------------------------------------------------------------
// Citation verification (section 10).
// ---------------------------------------------------------------------------

function recomputeCitationDefects(citation, sources, options) {
  const defects = new Set();
  const source = sources.get(citation.locator.value);
  if (source === undefined) {
    defects.add("SOURCE_NOT_FOUND");
    if (citation.locator.kind === "frozen-local") defects.add("FABRICATED_LOCATOR");
    return defects;
  }
  if (source.reachable === false
    || (citation.locator.kind === "url" && options.networkVerification === "disabled")) {
    defects.add("SOURCE_UNREACHABLE");
    return defects;
  }
  if (citation.contentDigest !== textDigest(source.text)) defects.add("DIGEST_MISMATCH");
  if (citation.declaredVersion !== source.version) defects.add("STALE_VERSION");

  const points = codePoints(source.text);
  const { startCodePoint: start, endCodePoint: end } = citation.excerpt;
  const inRange = start < end && end <= points.length;
  if (!inRange || citation.excerpt.digest !== textDigest(points.slice(start, end).join(""))) {
    defects.add("EXCERPT_NOT_IN_SOURCE");
  } else if (end - start > options.maxExcerptCodePoints) {
    defects.add("EXCERPT_LIMIT_EXCEEDED");
  }

  if ((source.contradicts ?? []).includes(options.claimId)) defects.add("CONTRADICTED_BY_SOURCE");
  if (options.authorityRequired === true && citation.authority.verified === false) {
    defects.add("AUTHORITY_UNVERIFIED");
  }

  // Provenance walk: a chain either revisits a source or terminates.
  if (source.derivedFromRunId === options.runId) {
    defects.add("CIRCULAR_REFERENCE");
  } else {
    const seen = new Set([source.sourceId]);
    let cursor = source;
    let cyclic = false;
    while (Object.hasOwn(cursor, "restates")) {
      const next = sources.get(cursor.restates);
      if (next === undefined) break;
      if (seen.has(next.sourceId)) {
        cyclic = true;
        break;
      }
      seen.add(next.sourceId);
      cursor = next;
    }
    if (cyclic) defects.add("CIRCULAR_REFERENCE");
    else if (cursor.sourceKind !== "primary") defects.add("CITATION_LAUNDERING");
  }
  return defects;
}

function outcomeFromDefects(defects) {
  if (defects.size === 0) return "supported";
  if (INACCESSIBILITY_DEFECTS.some((code) => defects.has(code))) return "inaccessible";
  if (defects.has("CONTRADICTED_BY_SOURCE")) return "contradicted";
  return "insufficient";
}

function checkCitationCase(testCase, context) {
  const label = `citationCases/${testCase.name}`;
  const rubric = context.rubricOf(testCase);
  const claim = testCase.claim;
  const sources = context.sources;

  check(G.CITATION_CLAIM_HASH, claim.claimHash === computeClaimHash(claim),
    `${label} claimHash drifted: expected ${computeClaimHash(claim)}`);
  const citationIds = claim.citations.map((item) => item.citationId);
  check(G.CITATION_IDS_UNIQUE, new Set(citationIds).size === citationIds.length,
    `${label} repeats a citationId`);
  checkEqual(G.CITATION_VERIFICATION_PAIRING,
    claim.verifications.map((item) => item.citationId), citationIds,
    `${label} verifications do not pair one-to-one with citations in order`);

  const options = {
    networkVerification: rubric.citation.networkVerification,
    maxExcerptCodePoints: rubric.citation.maxExcerptCodePoints,
    authorityRequired: rubric.citation.authorityRequired,
    claimId: claim.claimId,
    runId: claim.runId,
  };

  const observed = [];
  for (const [index, citation] of claim.citations.entries()) {
    const verification = claim.verifications[index];
    if (verification === undefined) break;
    const declared = new Set(verification.defects);

    // Rules over the declared pair are evaluated before the recomputation
    // rules. Pinning the defect set first would make every one of them
    // unreachable, which is precisely the shadowing the D4 audit found.
    checkEqual(G.CITATION_DEFECT_ORDER,
      verification.defects,
      CITATION_DEFECTS.filter((code) => declared.has(code)),
      `${label} citation ${citation.citationId} defects are not in vocabulary declaration order`);
    check(G.CITATION_SUPPORTED_NO_DEFECTS,
      verification.outcome !== "supported" || verification.defects.length === 0,
      `${label} citation ${citation.citationId} is supported while carrying defects`);
    check(G.CITATION_EXISTENCE_NOT_SUPPORT,
      !(verification.outcome === "insufficient" || verification.outcome === "contradicted")
      || !INACCESSIBILITY_DEFECTS.some((code) => declared.has(code)),
      `${label} citation ${citation.citationId} reports ${verification.outcome} with a resolution defect; `
      + "a source that could not be read is inaccessible, not unsupportive");
    check(G.CITATION_READ_ONLY_DEFECTS,
      verification.outcome !== "inaccessible"
      || !REACHABLE_ONLY_DEFECTS.some((code) => declared.has(code)),
      `${label} citation ${citation.citationId} reports inaccessible with a defect that could only be `
      + "observed by reading the source");
    check(G.CITATION_FABRICATION_IMPLIES_ABSENCE,
      !declared.has("FABRICATED_LOCATOR") || declared.has("SOURCE_NOT_FOUND"),
      `${label} citation ${citation.citationId} claims fabrication without absence`);
    check(G.CITATION_CIRCULAR_XOR_LAUNDERING,
      !(declared.has("CIRCULAR_REFERENCE") && declared.has("CITATION_LAUNDERING")),
      `${label} citation ${citation.citationId} claims a chain that both revisits and terminates`);
    check(G.CITATION_INACCESSIBLE_BICONDITIONAL,
      (verification.outcome === "inaccessible")
      === INACCESSIBILITY_DEFECTS.some((code) => declared.has(code)),
      `${label} citation ${citation.citationId} inaccessibility disagrees with its resolution defects`);
    check(G.CITATION_CONTRADICTED_BICONDITIONAL,
      (verification.outcome === "contradicted") === declared.has("CONTRADICTED_BY_SOURCE"),
      `${label} citation ${citation.citationId} contradiction disagrees with CONTRADICTED_BY_SOURCE`);
    check(G.CITATION_SUPPORT_MODE,
      Object.hasOwn(verification, "supportMode") === (verification.outcome === "supported"),
      `${label} citation ${citation.citationId} supportMode presence disagrees with its outcome`);
    check(G.CITATION_NO_NETWORK, verification.networkUsed === false,
      `${label} citation ${citation.citationId} used the network inside conformance`);
    check(G.CITATION_EXTERNAL_DISCLOSURE,
      verification.externalAvailabilityReported
      === (citation.locator.kind === "url" && options.networkVerification === "disabled"),
      `${label} citation ${citation.citationId} does not disclose that the harness disabled the network`);

    const computed = recomputeCitationDefects(citation, sources, options);
    for (const code of CITATION_DEFECTS) {
      check(G.CITATION_DEFECT_SET, computed.has(code) === declared.has(code),
        `${label} citation ${citation.citationId}: ${code} is ${computed.has(code) ? "" : "not "}`
        + `derivable but the corpus ${declared.has(code) ? "" : "does not "}declare it`);
    }
    const expectedOutcome = outcomeFromDefects(declared);
    check(G.CITATION_OUTCOME_DERIVED, verification.outcome === expectedOutcome,
      `${label} citation ${citation.citationId} outcome ${verification.outcome} disagrees with the `
      + `defect-derived ${expectedOutcome}`);
    observed.push(verification.outcome);
  }

  // Section 10.4: the binding ladder back onto the criterion outcome. The
  // cannot-pass rule is checked first so that it is not shadowed by the ladder.
  check(G.CITATION_UNVERIFIED_PASS,
    testCase.criterionOutcome !== "pass" || observed.every((item) => item === "supported"),
    `${label} passes a citation-required criterion on unsupported citations (CITATION_UNVERIFIED)`);
  const expectedCriterionOutcome = observed.includes("contradicted")
    ? "reject"
    : (observed.some((item) => item === "insufficient" || item === "inaccessible") ? "unknown" : null);
  if (expectedCriterionOutcome !== null) {
    check(G.CITATION_CRITERION_LADDER, testCase.criterionOutcome === expectedCriterionOutcome,
      `${label} criterion outcome ${testCase.criterionOutcome} disagrees with the citation ladder `
      + `${expectedCriterionOutcome}`);
  }

  return observed;
}

// ---------------------------------------------------------------------------
// Reflection (section 11).
// ---------------------------------------------------------------------------

const STOP_REASON_GUARD_OF = Object.freeze({
  converged: G.REFLECT_STOP_CONVERGED,
  "revision-limit": G.REFLECT_STOP_REVISION_LIMIT,
  "unknown-evidence": G.REFLECT_STOP_UNKNOWN,
  "no-progress": G.REFLECT_STOP_NO_PROGRESS,
  "ceiling-exhausted": G.REFLECT_STOP_CEILING,
  cancelled: G.REFLECT_STOP_CANCELLED,
});

function checkReflectionChain(testCase, context) {
  const rubric = context.rubricOf(testCase);
  const label = `reflectionChains/${testCase.name}`;
  const records = testCase.records;
  const deterministicIds = rubric.criteria
    .filter((item) => item.basis === "deterministic")
    .map((item) => item.criterionId);
  const byId = new Map(rubric.criteria.map((item) => [item.criterionId, item]));
  const criterionOrder = rubric.criteria.map((item) => item.criterionId);

  checkEqual(G.REFLECT_ATTEMPTS_CONTIGUOUS,
    records.map((item) => item.attempt),
    records.map((_item, index) => index + 1),
    `${label} attempts are not contiguous and strictly increasing from one`);

  const rubricHashes = new Set(records.map((item) => item.rubricHash));
  check(G.REFLECT_RUBRIC_STABLE, rubricHashes.size === 1 && rubricHashes.has(rubric.rubricHash),
    `${label} the rubric changed mid-chain (RUBRIC_DRIFT)`);

  for (const [index, record] of records.entries()) {
    const recordLabel = `${label}[${index}]`;
    check(G.REFLECT_ID, record.reflectionId === computeReflectionId(record),
      `${recordLabel} reflectionId drifted: expected ${computeReflectionId(record)}`);
    check(G.REFLECT_NEVER_EDITS, record.acceptedResultHash === record.subjectHash,
      `${recordLabel} silently edited the accepted result`);
    check(G.REFLECT_PROPOSAL_BICONDITIONAL,
      Object.hasOwn(record, "proposedResultHash") === (record.verdict === "reject"),
      `${recordLabel} proposedResultHash presence disagrees with verdict ${record.verdict}`);
    if (Object.hasOwn(record, "proposedResultHash")) {
      check(G.REFLECT_PROPOSAL_DIFFERS, record.proposedResultHash !== record.subjectHash,
        `${recordLabel} proposes the subject it is revising`);
    }
    check(G.REFLECT_ATTEMPT_BOUND, record.attempt <= record.ceiling.revisionsMax + 1,
      `${recordLabel} attempt ${record.attempt} exceeds revisionsMax + 1`);
    check(G.REFLECT_REVISIONS_USED, record.ceiling.revisionsUsed === record.attempt - 1,
      `${recordLabel} revisionsUsed ${record.ceiling.revisionsUsed} is not attempt - 1`);
    check(G.REFLECT_UNITS_BOUND, record.ceiling.unitsUsed <= record.ceiling.unitsMax,
      `${recordLabel} unitsUsed ${record.ceiling.unitsUsed} exceeds unitsMax ${record.ceiling.unitsMax}`);
    check(G.REFLECT_STOP_REASON_BICONDITIONAL,
      Object.hasOwn(record, "stopReason") === (record.stopped === true),
      `${recordLabel} stopReason presence disagrees with stopped ${record.stopped}`);
    check(G.REFLECT_LAST_STOPS, record.stopped === (index === records.length - 1),
      `${recordLabel} stopped=${record.stopped}; exactly the last record of a chain stops`);

    checkEqual(G.REFLECT_DETERMINISTIC_COVERAGE,
      record.deterministicChecks.map((item) => item.criterionId), deterministicIds,
      `${recordLabel} deterministicChecks do not cover exactly the deterministic criteria in order`);
    for (const issue of record.issues) {
      check(G.REFLECT_ISSUE_BASIS,
        byId.has(issue.criterionId) && issue.basis === byId.get(issue.criterionId).basis,
        `${recordLabel} issue on ${issue.criterionId} declares basis ${issue.basis}`);
    }
    const issueOrder = record.issues.map((item) => criterionOrder.indexOf(item.criterionId));
    check(G.REFLECT_ISSUE_ORDER,
      issueOrder.every((value, position) => position === 0 || issueOrder[position - 1] <= value),
      `${recordLabel} issues are not in rubric criterion declaration order`);
    checkEqual(G.REFLECT_MODEL_PERMISSIONS, record.modelJudgment,
      { sameModelPermitted: rubric.reflection.sameModelPermitted,
        sameContextPermitted: rubric.independence.sharedContextPermitted },
      `${recordLabel} declared permissions do not mirror the rubric`);

    if (index > 0) {
      const previous = records[index - 1];
      check(G.REFLECT_CHAIN_LINK, record.subjectHash === previous.proposedResultHash,
        `${recordLabel} reviews ${record.subjectHash} rather than its predecessor's proposal`);
    }

    if (record.stopped !== true) continue;

    const earlierSubjects = new Set(records.slice(0, index).map((item) => item.subjectHash));
    const conditions = {
      converged: record.verdict === "pass",
      "revision-limit": record.ceiling.revisionsUsed === record.ceiling.revisionsMax,
      "unknown-evidence": record.verdict === "unknown",
      "no-progress": Object.hasOwn(record, "proposedResultHash")
        && earlierSubjects.has(record.proposedResultHash),
      "ceiling-exhausted": record.ceiling.unitsUsed === record.ceiling.unitsMax,
      cancelled: testCase.cancelled === true,
    };
    if (!Object.hasOwn(record, "stopReason")) continue;
    check(STOP_REASON_GUARD_OF[record.stopReason], conditions[record.stopReason] === true,
      `${recordLabel} stopped with ${record.stopReason} but its condition does not hold`);
  }

  const terminal = records[records.length - 1];
  check(G.REFLECT_NOT_ACCEPTED,
    terminal.verdict === "pass" || testCase.consumedAsAccepted === false,
    `${label} terminal verdict ${terminal.verdict} yet the chain is consumed as an accepted result`);
  return terminal.stopReason;
}

// ---------------------------------------------------------------------------
// Replay (section 12).
// ---------------------------------------------------------------------------

function replayOutcome(testCase, rubric) {
  const events = testCase.history;
  const seen = new Set();
  for (const event of events) {
    if (seen.has(event.nodeId)) return { outcome: "rejected", code: "DUPLICATE_DECISION" };
    seen.add(event.nodeId);
  }
  for (const event of events) {
    if (event.data.rubricHash !== rubric.rubricHash) {
      return { outcome: "rejected", code: "RUBRIC_DRIFT" };
    }
    const recomputed = computePanelDecisionId(event.data, {
      runId: testCase.runId,
      graphRevision: testCase.graphRevision,
      panelNodeId: event.nodeId,
    });
    if (recomputed !== event.data.panelDecisionId) {
      return { outcome: "rejected", code: "DECISION_IDENTITY_MISMATCH" };
    }
  }
  return { outcome: "adopted" };
}

const REPLAY_GUARD_OF = Object.freeze({
  RUBRIC_DRIFT: G.REPLAY_RUBRIC_DRIFT,
  DECISION_IDENTITY_MISMATCH: G.REPLAY_IDENTITY_MISMATCH,
  DUPLICATE_DECISION: G.REPLAY_DUPLICATE,
});

function checkReplay(testCase, context) {
  const label = `replayCases/${testCase.name}`;
  const rubric = context.rubricOf(testCase);
  const observed = replayOutcome(testCase, rubric);
  const declared = testCase.expect;

  if (observed.outcome === "rejected") {
    check(REPLAY_GUARD_OF[observed.code],
      declared.outcome === "rejected" && declared.code === observed.code,
      `${label} recomputes ${observed.code}; the corpus declares `
      + `${declared.outcome}${declared.code ? `/${declared.code}` : ""}`);
  } else {
    check(G.REPLAY_OUTCOME, declared.outcome === "adopted",
      `${label} recomputes an adoptable history; the corpus declares ${declared.outcome}`);
    check(G.REPLAY_ZERO_EXECUTOR, declared.expectedExecutorCalls === 0,
      `${label} adopts a committed decision at a cost of ${declared.expectedExecutorCalls} executor calls`);
    check(G.REPLAY_ZERO_PROVIDER, declared.expectedProviderCalls === 0,
      `${label} adopts a committed decision at a cost of ${declared.expectedProviderCalls} provider calls`);
    check(G.REPLAY_ZERO_APPEND, declared.appendedDecisionEvents === 0,
      `${label} appended ${declared.appendedDecisionEvents} decision events on adoption`);
    checkEqual(G.REPLAY_DECISION_ID,
      declared.decisionIds,
      testCase.history.map((event) => computePanelDecisionId(event.data, {
        runId: testCase.runId,
        graphRevision: testCase.graphRevision,
        panelNodeId: event.nodeId,
      })),
      `${label} declared seeded decision identities drifted from the recomputed preimage`);
  }

  if (Object.hasOwn(declared, "forkedFromRunId")) {
    const event = testCase.history[0];
    const parent = computePanelDecisionId(event.data, {
      runId: declared.forkedFromRunId,
      graphRevision: testCase.graphRevision,
      panelNodeId: event.nodeId,
    });
    check(G.REPLAY_FORK_IDENTITY,
      declared.parentDecisionId === parent && parent !== event.data.panelDecisionId,
      `${label} a fork reused the parent decision identity`);
  }
  return observed;
}

// ---------------------------------------------------------------------------
// Mode B (section 13.5).
// ---------------------------------------------------------------------------

function checkModeB(testCase, context) {
  const label = `modeBCases/${testCase.name}`;
  const rubric = context.rubricOf(testCase);
  const policy = testCase.barrierPolicy;

  check(G.MODE_B_QUORUM_ONLY, policy.kind === "quorum",
    `${label} delegates a tally to a ${policy.kind} barrier; a non-quorum barrier does not inspect `
    + "upstream values, so a refutation would be counted as an acceptance");
  const rubricThreshold = rubric.decision.threshold;
  const mirrored = policy.kind === "quorum"
    && rubricThreshold.kind === "quorum"
    && policy.quorum.accepts === rubricThreshold.accepts
    && policy.quorum.countAbstainAsParticipant === rubricThreshold.countAbstainAsParticipant;
  check(G.MODE_B_THRESHOLD_MIRROR, mirrored,
    `${label} the delegated barrier does not mirror the rubric threshold member for member`);
  check(G.MODE_B_NO_EXCLUSION,
    rubric.independence.sameIdentityPermitted === true
    && rubric.independence.separationProofRequired === false,
    `${label} delegates a tally from a rubric that can exclude a seat; the barrier has no disposition `
    + "member meaning 'a ballot was cast and then excluded on provenance grounds'");

  for (const projection of testCase.projections) {
    const ballot = context.ballots.get(projection.verdictHash);
    const vote = {
      apiVersion: BARRIER_CONTRACT_API_VERSION,
      kind: "BarrierVote",
      verdict: BALLOT_TO_BARRIER_VERDICT[ballot.verdict],
      ...(Object.hasOwn(ballot, "confidenceBasisPoints")
        ? { confidenceBasisPoints: ballot.confidenceBasisPoints }
        : {}),
    };
    checkEqual(G.MODE_B_VOTE_VALID, projection.vote, vote, `${label} projected vote drifted`);
    assert.equal(context.validateBarrierVote(vote), true,
      `${label} projected vote is rejected by the frozen barrier vote schema: `
      + JSON.stringify(context.validateBarrierVote.errors));
    check(G.MODE_B_RAW_VERDICT_REFUSED,
      projection.rawVerdictAcceptedAsBarrierVote === context.validateBarrierVote(ballot),
      `${label} a raw VerifierVerdict must fail the frozen BarrierVote schema as INVALID_BARRIER_VOTE `
      + `at the vote boundary; the corpus declares ${projection.rawVerdictAcceptedAsBarrierVote} and the `
      + `schema says ${context.validateBarrierVote(ballot)}`);
  }
  return testCase.projections.length;
}

// ---------------------------------------------------------------------------
// The corpus run.
// ---------------------------------------------------------------------------

let cachedFixture = null;
let cachedSchemas = null;

async function loadOnce() {
  if (cachedFixture === null) {
    cachedFixture = JSON.parse(await readFile(CASE_PATH, "utf8"));
  }
  if (cachedSchemas === null) {
    const names = [
      ...Object.values(SCHEMA_FILES),
      BARRIER_DECISION_SCHEMA,
      BARRIER_VOTE_SCHEMA,
    ];
    const entries = await Promise.all(names.map(async (name) => [
      name,
      JSON.parse(await readFile(join(specRoot, name), "utf8")),
    ]));
    cachedSchemas = Object.fromEntries(entries);
  }
  return { fixture: cachedFixture, schemas: cachedSchemas };
}

function buildValidators(schemas) {
  const ajv = new Ajv2020({ strict: true, allErrors: false, allowUnionTypes: true });
  const compiled = {};
  for (const [key, name] of Object.entries(SCHEMA_FILES)) compiled[key] = ajv.compile(schemas[name]);
  compiled.barrierDecision = ajv.compile(schemas[BARRIER_DECISION_SCHEMA]);
  compiled.barrierVote = ajv.compile(schemas[BARRIER_VOTE_SCHEMA]);
  return compiled;
}

function runCorpus(fixture, validators) {
  const coverage = {
    lens: new Set(),
    severity: new Set(),
    ballotVerdict: new Set(),
    censusVerdict: new Set(),
    participation: new Set(),
    exclusionCode: new Set(),
    criterionBasis: new Set(),
    criterionOutcome: new Set(),
    thresholdKind: new Set(),
    reasonCode: new Set(),
    reasonClass: new Set(),
    resolution: new Set(),
    terminal: new Set(),
    aggregation: new Set(),
    tieBreakRung: new Set(),
    citationOutcome: new Set(),
    supportMode: new Set(),
    citationDefect: new Set(),
    reflectionStopReason: new Set(),
    failureCode: new Set(),
    foldRung: new Set(),
    replayRejectionCode: new Set(),
  };

  // --- header honesty -----------------------------------------------------
  check(G.HEADER_IMPLEMENTATION_CLAIM, fixture.implementationClaim === false,
    "the corpus does not declare implementationClaim exactly false");
  check(G.HEADER_CLAIM_FLAGS, Object.values(fixture.claims).every((value) => value === false),
    `the corpus carries a claim flag that is not literally false: ${stable(fixture.claims)}`);
  // Scans the document families only. The negative-vector families are excluded
  // deliberately: a vector must be able to *name* a forbidden construct in order
  // to prove that naming one is refused.
  const serialized = canonicalSerialize({
    rubrics: fixture.rubrics,
    verdicts: fixture.verdicts,
    panelCases: fixture.panelCases,
    judgeCases: fixture.judgeCases,
    citationSources: fixture.citationSources,
    citationCases: fixture.citationCases,
    reflectionChains: fixture.reflectionChains,
    modeBCases: fixture.modeBCases,
    replayCases: fixture.replayCases,
  });
  const forbidden = ["Date.now", "wallClock", "performance.now", "providerCall", "systemClock"];
  check(G.HEADER_NO_WALL_CLOCK, forbidden.every((needle) => !serialized.includes(needle)),
    `the corpus names a forbidden construct: ${forbidden.find((needle) => serialized.includes(needle))}`);

  // --- rubrics ------------------------------------------------------------
  const rubrics = new Map();
  for (const rubric of fixture.rubrics) {
    checkRubric(rubric);
    rubrics.set(`${rubric.rubricId}@${rubric.rubricVersion}`, rubric);
    for (const criterion of rubric.criteria) {
      coverage.lens.add(criterion.lens);
      coverage.severity.add(criterion.severity);
      coverage.criterionBasis.add(criterion.basis);
    }
    coverage.thresholdKind.add(rubric.decision.threshold.kind);
    if (Object.hasOwn(rubric.decision, "aggregation")) coverage.aggregation.add(rubric.decision.aggregation);
  }
  const rubricOf = (item) => {
    const key = `${item.rubricId}@${item.rubricVersion}`;
    const rubric = rubrics.get(key);
    assert.ok(rubric !== undefined, `corpus references unknown rubric ${key}`);
    return rubric;
  };

  // --- ballots ------------------------------------------------------------
  const ballots = new Map();
  for (const entry of fixture.verdicts) {
    const [refId, refVersion] = entry.rubricRef.split("@");
    const rubric = rubricOf({ rubricId: refId, rubricVersion: refVersion });
    const subject = entry.subject ?? null;
    const rung = checkVerdict(entry.verdict, rubric, subject);
    if (rung !== undefined) coverage.foldRung.add(rung);
    ballots.set(entry.verdict.verdictHash, entry.verdict);
    coverage.ballotVerdict.add(entry.verdict.verdict);
    coverage.lens.add(entry.verdict.lens);
    for (const outcome of entry.verdict.criterionOutcomes ?? []) {
      coverage.criterionOutcome.add(outcome.outcome);
    }
    for (const finding of entry.verdict.findings) coverage.severity.add(finding.severity);
  }

  const context = {
    ballots,
    rubricOf,
    sources: new Map(fixture.citationSources.map((item) => [item.sourceId, item])),
    validateBarrierDecision: validators.barrierDecision,
    validateBarrierVote: validators.barrierVote,
  };

  // --- panels -------------------------------------------------------------
  for (const testCase of fixture.panelCases) {
    const rubric = rubricOf(testCase.decision);
    const result = checkPanel(testCase, { ...context, rubric, ballots });
    if (result === null) continue;
    coverage.reasonCode.add(result.reasonCode);
    coverage.reasonClass.add(result.reasonClass);
    coverage.resolution.add(result.resolution);
    coverage.terminal.add(result.terminal);
    for (const seat of testCase.decision.seats) {
      coverage.participation.add(seat.participation);
      coverage.censusVerdict.add(seat.verdict);
      if (Object.hasOwn(seat, "exclusionCode")) coverage.exclusionCode.add(seat.exclusionCode);
    }
  }

  // --- judge panels -------------------------------------------------------
  for (const testCase of fixture.judgeCases) {
    const rubric = rubricOf(testCase.decision);
    checkPanel(testCase, { ...context, rubric, ballots });
    const judged = checkJudgePanel(testCase, { ...context, rubric, ballots });
    if (judged === null) continue;
    coverage.aggregation.add(judged.aggregation);
    for (const rung of judged.rungs) coverage.tieBreakRung.add(rung);
    coverage.resolution.add(testCase.decision.resolution);
    coverage.terminal.add(testCase.decision.terminal);
    coverage.reasonCode.add(testCase.decision.reasonCode);
    coverage.reasonClass.add(testCase.decision.reasonClass);
    for (const seat of testCase.decision.seats) {
      coverage.participation.add(seat.participation);
      coverage.censusVerdict.add(seat.verdict);
    }
  }

  // --- citations ----------------------------------------------------------
  for (const testCase of fixture.citationCases) {
    const outcomes = checkCitationCase(testCase, context);
    for (const outcome of outcomes) coverage.citationOutcome.add(outcome);
    for (const verification of testCase.claim.verifications) {
      for (const defect of verification.defects) coverage.citationDefect.add(defect);
      if (Object.hasOwn(verification, "supportMode")) coverage.supportMode.add(verification.supportMode);
    }
  }

  // --- reflection ---------------------------------------------------------
  for (const testCase of fixture.reflectionChains) {
    coverage.reflectionStopReason.add(checkReflectionChain(testCase, context));
  }

  // --- mode B -------------------------------------------------------------
  for (const testCase of fixture.modeBCases) checkModeB(testCase, context);

  // --- replay -------------------------------------------------------------
  const replayCodes = new Set();
  for (const testCase of fixture.replayCases) {
    const observed = checkReplay(testCase, context);
    if (observed.outcome === "rejected") replayCodes.add(observed.code);
  }
  coverage.replayRejectionCode = replayCodes;

  // Portable failure codes are covered by naming the guards that enforce them.
  for (const code of Object.keys(fixture.failureCodeGuards)) coverage.failureCode.add(code);

  return coverage;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

let cachedVectors = null;

function prepareGuardVectors(fixture) {
  if (cachedVectors === null) {
    cachedVectors = fixture.guardCases.map((testCase) => {
      assert.ok(declaredGuards.has(testCase.guard),
        `guardCases/${testCase.name} targets undeclared guard ${testCase.guard}`);
      return {
        name: testCase.name,
        guard: testCase.guard,
        fixture: applyMutations(fixture, testCase.mutations),
      };
    });
    const names = cachedVectors.map((item) => item.name);
    assert.equal(new Set(names).size, names.length, "guardCases names are not unique");
  }
  return cachedVectors;
}

/**
 * Runs one prepared vector and reports what fired. In `probe` mode a failure
 * outside the guard layer counts as a distinct outcome rather than an error:
 * neutralizing a presence guard can leave a later rule reading an absent
 * member, and the corpus failing that way is still the corpus failing.
 */
function fireGuard(mutatedFixture, validators, probe = false) {
  const previous = disabledGuard;
  try {
    runCorpus(mutatedFixture, validators);
    return null;
  } catch (error) {
    if (error instanceof GuardError) return error.guardId;
    if (probe) return "OUTSIDE_GUARD_LAYER";
    throw new Error(`a negative vector failed outside the guard layer: ${error.stack}`);
  } finally {
    disabledGuard = previous;
  }
}

export async function validateVerificationFixture(options = {}) {
  const { fixture, schemas } = await loadOnce();
  const validators = buildValidators(schemas);
  const previous = disabledGuard;
  disabledGuard = options.disabledGuard ?? null;
  let coverage;
  try {
    coverage = runCorpus(fixture, validators);
  } finally {
    disabledGuard = previous;
  }
  if (options.guardProbe === true) return null;

  // ---- schema conformance of every positive document ---------------------
  const schemaChecks = [];
  for (const rubric of fixture.rubrics) schemaChecks.push(["rubric", rubric]);
  for (const entry of fixture.verdicts) schemaChecks.push(["verdict", entry.verdict]);
  for (const testCase of [...fixture.panelCases, ...fixture.judgeCases]) {
    schemaChecks.push(["panel", testCase.decision]);
  }
  for (const testCase of fixture.citationCases) schemaChecks.push(["citation", testCase.claim]);
  for (const testCase of fixture.reflectionChains) {
    for (const record of testCase.records) schemaChecks.push(["reflection", record]);
  }
  for (const [key, document] of schemaChecks) {
    assert.equal(validators[key](document), true,
      `${key} document rejected by its own schema: ${JSON.stringify(validators[key].errors)}`);
  }
  assert.ok(schemaChecks.length >= 60,
    `too few positive documents to be evidence: ${schemaChecks.length}`);

  // ---- schema negatives ---------------------------------------------------
  const schemaNegativeKeywords = new Set();
  for (const testCase of fixture.schemaNegativeCases) {
    const base = testCase.family === "rubric"
      ? fixture.rubrics.find((item) => `${item.rubricId}@${item.rubricVersion}` === testCase.base)
      : testCase.family === "verdict"
        ? fixture.verdicts.find((item) => item.verdict.verifierId === testCase.base).verdict
        : testCase.family === "panel"
          ? [...fixture.panelCases, ...fixture.judgeCases].find((item) => item.name === testCase.base).decision
          : testCase.family === "citation"
            ? fixture.citationCases.find((item) => item.name === testCase.base).claim
            : fixture.reflectionChains.find((item) => item.name === testCase.base).records[0];
    assert.ok(base !== undefined, `schemaNegativeCases/${testCase.name} names an unknown base`);
    const mutated = applyMutations(base, testCase.mutations);
    const validate = validators[testCase.family];
    assert.equal(validate(mutated), false,
      `schemaNegativeCases/${testCase.name} was accepted by the ${testCase.family} schema`);
    const first = validate.errors[0];
    assert.equal(first.instancePath, testCase.expectInstancePath,
      `schemaNegativeCases/${testCase.name} first error path drifted: saw ${first.instancePath}`);
    assert.equal(first.keyword, testCase.expectKeyword,
      `schemaNegativeCases/${testCase.name} first error keyword drifted: saw ${first.keyword}`);
    schemaNegativeKeywords.add(first.keyword);
  }
  assert.ok(schemaNegativeKeywords.size >= 5,
    `schema negatives exercise only ${schemaNegativeKeywords.size} distinct keywords`);

  // ---- semantic negatives -------------------------------------------------
  const guardsWithVectors = new Set();
  assert.ok(fixture.guardCases.length > 0, "the corpus ships no semantic negative vector");
  for (const vector of prepareGuardVectors(fixture)) {
    const fired = fireGuard(vector.fixture, validators);
    assert.equal(fired, vector.guard,
      `guardCases/${vector.name} expected guard ${vector.guard}, saw ${fired ?? "no guard"}`);
    guardsWithVectors.add(vector.guard);
  }

  // ---- every guard is reachable and isolated ------------------------------
  const declared = [...declaredGuards].sort(compareUnicodeCodePoints);
  const untouched = declared.filter((id) => !touchedGuards.has(id));
  assert.deepEqual(untouched, [],
    `these guards are never evaluated by any fixture and are therefore dead: ${untouched.join(", ")}`);
  const uncovered = declared.filter((id) => !guardsWithVectors.has(id));
  assert.deepEqual(uncovered, fixture.guardSurvivability.disclosedSurvivors,
    `guards without an isolating vector drifted from the disclosed list: ${uncovered.join(", ")}`);

  // ---- closed-vocabulary coverage as a hard failure ----------------------
  for (const [name, members] of Object.entries(VOCABULARIES)) {
    assert.deepEqual(
      members.filter((member) => !coverage[name].has(member)),
      [],
      `vocabulary '${name}' has members no fixture exercises`,
    );
    assert.deepEqual(
      [...coverage[name]].filter((member) => !members.includes(member)).sort(compareUnicodeCodePoints),
      [],
      `vocabulary '${name}' was exercised with a member outside the closed set`,
    );
  }
  assert.deepEqual(
    FOLD_RUNGS.map((_rung, index) => index).filter((index) => !coverage.foldRung.has(index)),
    [],
    "the five-rung ballot fold has rungs no ballot decides on",
  );
  assert.deepEqual(
    REPLAY_REJECTION_CODES.filter((code) => !coverage.replayRejectionCode.has(code)),
    [],
    "replayCases never exercise every zero-rejudge rejection code",
  );

  // ---- every portable failure code is enforced by a guard with a vector ----
  assert.deepEqual(Object.keys(fixture.failureCodeGuards).sort(compareUnicodeCodePoints),
    [...FAILURE_CODES].sort(compareUnicodeCodePoints),
    "the failure-code-to-guard map does not cover exactly the eight portable failure codes");
  for (const [code, guardIds] of Object.entries(fixture.failureCodeGuards)) {
    assert.ok(guardIds.length > 0, `failure code ${code} names no enforcing guard`);
    for (const guardId of guardIds) {
      assert.ok(declaredGuards.has(guardId), `failure code ${code} names undeclared guard ${guardId}`);
      assert.ok(guardsWithVectors.has(guardId) || uncovered.includes(guardId),
        `failure code ${code} names guard ${guardId}, which has neither a vector nor a disclosure`);
    }
  }

  // ---- the corpus must agree with the transcribed constants ---------------
  assert.equal(fixture.contract, CONTRACT, "corpus contract identifier drifted");
  for (const [name, members] of Object.entries(VOCABULARIES)) {
    assert.deepEqual(fixture.vocabularies[name], members, `corpus vocabulary '${name}' drifted`);
  }
  assert.deepEqual(fixture.reusedFailureCodes, REUSED_CODES, "corpus reused-code list drifted");
  assert.deepEqual(fixture.reasonClassPartition, REASON_CLASS_OF, "corpus reason-class partition drifted");
  assert.deepEqual(fixture.resolutionTerminal, TERMINAL_OF, "corpus resolution/terminal map drifted");
  assert.deepEqual(fixture.ballotToBarrierVerdict, BALLOT_TO_BARRIER_VERDICT,
    "corpus ballot-to-barrier projection drifted");
  assert.deepEqual(fixture.seatToBarrierDisposition, BARRIER_PROJECTION,
    "corpus seat-to-barrier projection drifted");
  assert.deepEqual(fixture.notCastSeatKeys, NOT_CAST_SEAT_KEYS, "corpus not-cast seat key set drifted");
  assert.deepEqual(fixture.notCastBarrierRecordKeys, NOT_CAST_BARRIER_RECORD_KEYS,
    "corpus not-cast barrier record key set drifted");
  assert.deepEqual(Object.keys(fixture.schemas).sort(compareUnicodeCodePoints),
    Object.keys(SCHEMA_FILES).sort(compareUnicodeCodePoints), "corpus schema manifest drifted");
  for (const [key, name] of Object.entries(SCHEMA_FILES)) {
    assert.equal(fixture.schemas[key], name, `corpus schema manifest entry '${key}' drifted`);
  }
  // The 4 + 4 + 3 partition is total and disjoint over exactly the eleven codes.
  assert.deepEqual(Object.keys(REASON_CLASS_OF).sort(compareUnicodeCodePoints),
    [...REASON_CODES].sort(compareUnicodeCodePoints), "the reason-class partition is not total");
  for (const [className, expected] of [["satisfied", 4], ["unsatisfied", 4], ["insufficient", 3]]) {
    assert.equal(
      Object.values(REASON_CLASS_OF).filter((item) => item === className).length,
      expected,
      `the '${className}' reason class does not hold ${expected} codes`,
    );
  }

  return {
    contract: fixture.contract,
    implementationClaim: fixture.implementationClaim,
    claims: { ...fixture.claims },
    rubrics: fixture.rubrics.length,
    verdicts: fixture.verdicts.length,
    panelCases: fixture.panelCases.length,
    judgeCases: fixture.judgeCases.length,
    citationSources: fixture.citationSources.length,
    citationCases: fixture.citationCases.length,
    reflectionChains: fixture.reflectionChains.length,
    reflectionRecords: fixture.reflectionChains.reduce((sum, item) => sum + item.records.length, 0),
    modeBCases: fixture.modeBCases.length,
    replayCases: fixture.replayCases.length,
    schemaNegativeCases: fixture.schemaNegativeCases.length,
    guardCases: fixture.guardCases.length,
    positiveDocuments: schemaChecks.length,
    guards: declaredGuards.size,
    guardsWithVectors: guardsWithVectors.size,
    recomputedLiterals:
      fixture.rubrics.length
      + fixture.verdicts.length
      + fixture.panelCases.length * 2
      + fixture.judgeCases.length * 2
      + fixture.citationCases.length
      + fixture.reflectionChains.reduce((sum, item) => sum + item.records.length, 0)
      + fixture.replayCases.reduce((sum, item) => sum + item.history.length, 0),
  };
}

/**
 * Re-runs the whole corpus once per guard with that guard neutralized and
 * requires a failure each time. A guard whose neutralization leaves the corpus
 * green has no isolating vector and is reported by name.
 */
export async function measureGuardSurvivability() {
  const { fixture, schemas } = await loadOnce();
  const validators = buildValidators(schemas);
  const vectors = prepareGuardVectors(fixture);
  const survivors = [];
  const ordered = [...declaredGuards].sort(compareUnicodeCodePoints);
  for (const guardId of ordered) {
    // The guard's own vector is probed first, so the common case costs one run.
    const probeOrder = [
      ...vectors.filter((item) => item.guard === guardId),
      ...vectors.filter((item) => item.guard !== guardId),
    ];
    let detected = false;
    const previous = disabledGuard;
    try {
      disabledGuard = guardId;
      for (const vector of probeOrder) {
        // Neutralizing a real guard must make some vector stop reporting the
        // guard it targets. That is exactly what the negative pass asserts.
        if (fireGuard(vector.fixture, validators, true) !== vector.guard) {
          detected = true;
          break;
        }
      }
    } finally {
      disabledGuard = previous;
    }
    if (!detected) survivors.push(guardId);
  }
  return {
    measuredGuards: ordered.length,
    held: ordered.length - survivors.length,
    survivors,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await validateVerificationFixture();
  const survivability = await measureGuardSurvivability();
  const { fixture } = await loadOnce();
  assert.deepEqual(survivability.survivors, fixture.guardSurvivability.disclosedSurvivors,
    `measured guard survivors ${JSON.stringify(survivability.survivors)} disagree with the disclosed list `
    + JSON.stringify(fixture.guardSurvivability.disclosedSurvivors));
  assert.equal(survivability.measuredGuards, fixture.guardSurvivability.measuredGuards,
    "the disclosed guard count drifted from the registry");
  assert.equal(survivability.held, fixture.guardSurvivability.held,
    "the disclosed guard-neutralization measurement drifted");
  process.stdout.write(`${JSON.stringify({ ...summary, guardSurvivability: survivability }, null, 2)}\n`);
}
