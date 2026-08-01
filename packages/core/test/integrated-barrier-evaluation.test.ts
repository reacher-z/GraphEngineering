import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  BARRIER_UNSATISFIED_RESOLUTION,
  BARRIER_VERDICT_DISPOSITION,
  INTEGRATED_BARRIER_API_VERSION,
  canonicalHash,
  evaluateIntegratedBarrier,
  validateBarrierPolicy,
  validateBarrierVote,
  type BarrierArrival,
  type BarrierArrivalDisposition,
  type BarrierDecisionCore,
  type BarrierVote,
  type IntegratedBarrierPolicySnapshot,
} from "../src/index.js";

interface EvaluationCase {
  readonly name: string;
  readonly policy: Readonly<Record<string, unknown>>;
  readonly barrierNodeId: string;
  readonly dispositions: readonly {
    readonly sourceNodeId: string;
    readonly disposition: BarrierArrivalDisposition;
    readonly vote?: Readonly<Record<string, unknown>>;
  }[];
  readonly expect: Readonly<Record<string, unknown>>;
}

interface BarrierCorpus {
  readonly vocabulary: {
    readonly dispositions: readonly string[];
    readonly quorumOnlyDispositions: readonly string[];
    readonly verdicts: readonly string[];
    readonly voteRecordVerdicts: readonly string[];
    readonly decisionOnlyVerdicts: readonly string[];
    readonly nonVotingDispositions: readonly string[];
    readonly verdictToDisposition: Readonly<Record<string, string>>;
    readonly reasonCodes: readonly string[];
    readonly resolutions: readonly string[];
    readonly resolutionByOnUnsatisfied: Readonly<Record<string, string>>;
    readonly dispositionToCountField: Readonly<Record<string, string>>;
    readonly dispositionToIdList: Readonly<Record<string, string>>;
  };
  readonly satisfactionArithmetic: {
    readonly percentage: string;
    readonly deadlineElapsedRule: string;
  };
  readonly voteCensus: {
    readonly notCastRecordShape: string;
    readonly upstreamMayNeverCastNotCast: boolean;
  };
  readonly hashContract: { readonly evidenceHash: string };
  readonly evaluationCases: readonly EvaluationCase[];
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url),
  "utf8",
)) as BarrierCorpus;

/** Re-validate the corpus policy rather than casting it, so the two agree. */
function policyOf(evaluationCase: EvaluationCase): IntegratedBarrierPolicySnapshot {
  const validated = validateBarrierPolicy(evaluationCase.policy);
  if (!validated.valid) throw new Error(`corpus policy is invalid: ${evaluationCase.name}`);
  return validated.policy;
}

/** Re-validate every corpus ballot through the real carrier validator. */
function arrivalsOf(evaluationCase: EvaluationCase): readonly BarrierArrival[] {
  return evaluationCase.dispositions.map((entry) => {
    if (entry.vote === undefined) {
      return { sourceNodeId: entry.sourceNodeId, disposition: entry.disposition };
    }
    const validated = validateBarrierVote(entry.vote);
    if (!validated.valid) throw new Error(`corpus vote is malformed: ${evaluationCase.name}`);
    return {
      sourceNodeId: entry.sourceNodeId,
      disposition: entry.disposition,
      vote: validated.vote,
    };
  });
}

function decide(evaluationCase: EvaluationCase): BarrierDecisionCore {
  return evaluateIntegratedBarrier(
    policyOf(evaluationCase),
    evaluationCase.barrierNodeId,
    arrivalsOf(evaluationCase),
  );
}

const vote = (verdict: string, extra: Readonly<Record<string, unknown>> = {}): unknown => ({
  apiVersion: INTEGRATED_BARRIER_API_VERSION,
  kind: "BarrierVote",
  verdict,
  ...extra,
});

describe("integrated barrier evaluation conformance", () => {
  test("this suite consumes the whole evaluation section", () => {
    expect(corpus.evaluationCases).toHaveLength(41);
    expect(new Set(corpus.evaluationCases.map((item) => item.name)).size).toBe(41);
  });

  test.each(corpus.evaluationCases)("evaluation: $name", (evaluationCase) => {
    // Deep equality against the literal corpus expectation, so an extra or a
    // missing member of the decision document fails rather than passing.
    expect(decide(evaluationCase)).toEqual(evaluationCase.expect);
  });

  test("the corpus vocabulary is the implemented vocabulary", () => {
    expect(BARRIER_VERDICT_DISPOSITION).toEqual(corpus.vocabulary.verdictToDisposition);
    expect(BARRIER_UNSATISFIED_RESOLUTION).toEqual(corpus.vocabulary.resolutionByOnUnsatisfied);
    expect(Object.keys(BARRIER_VERDICT_DISPOSITION)).toEqual(corpus.vocabulary.verdicts);
    expect(new Set(Object.values(BARRIER_UNSATISFIED_RESOLUTION)))
      .toEqual(new Set(corpus.vocabulary.resolutions.filter((item) => item !== "satisfied")));
  });

  test("every reason code and resolution the corpus closes is reachable", () => {
    const reasonCodes = new Set(corpus.evaluationCases.map((item) => item.expect.reasonCode));
    expect([...reasonCodes].sort()).toEqual([...corpus.vocabulary.reasonCodes].sort());
    const resolutions = new Set(corpus.evaluationCases.map((item) => item.expect.resolution));
    expect([...resolutions].sort()).toEqual([...corpus.vocabulary.resolutions].sort());
    // Every resolution actually produced by the implementation, not only by the
    // corpus literals.
    expect([...new Set(corpus.evaluationCases.map((item) => decide(item).resolution))].sort())
      .toEqual([...corpus.vocabulary.resolutions].sort());
  });

  test("the counts sum to total and the ID lists partition the arrivals", () => {
    for (const evaluationCase of corpus.evaluationCases) {
      const decision = decide(evaluationCase) as unknown as Record<string, number | string[]>;
      const counts = Object.values(corpus.vocabulary.dispositionToCountField)
        .reduce((sum, field) => sum + (decision[field] as number), 0);
      expect(counts, evaluationCase.name).toBe(decision.total);
      const ids = Object.values(corpus.vocabulary.dispositionToIdList)
        .flatMap((field) => decision[field] as string[]);
      expect([...ids].sort(), evaluationCase.name)
        .toEqual([...evaluationCase.dispositions.map((item) => item.sourceNodeId)].sort());
      // Each list keeps incoming-edge declaration order.
      for (const [disposition, field] of Object.entries(corpus.vocabulary.dispositionToIdList)) {
        expect(decision[field], `${evaluationCase.name}:${field}`).toEqual(
          evaluationCase.dispositions
            .filter((item) => item.disposition === disposition)
            .map((item) => item.sourceNodeId),
        );
      }
    }
  });

  test("an unsatisfied barrier is never satisfied and never resolves to satisfied", () => {
    for (const evaluationCase of corpus.evaluationCases) {
      const decision = decide(evaluationCase);
      expect(decision.satisfied === (decision.resolution === "satisfied"), evaluationCase.name)
        .toBe(true);
    }
  });

  test("deadlineElapsed is true exactly when some arrival timed out", () => {
    expect(corpus.satisfactionArithmetic.deadlineElapsedRule)
      .toContain("at least one disposition entry is timed_out");
    for (const evaluationCase of corpus.evaluationCases) {
      expect(decide(evaluationCase).deadlineElapsed, evaluationCase.name).toBe(
        evaluationCase.dispositions.some((item) => item.disposition === "timed_out"),
      );
    }
  });

  test("votes are present exactly for quorum policies and cover every arrival", () => {
    for (const evaluationCase of corpus.evaluationCases) {
      const decision = decide(evaluationCase);
      const quorum = evaluationCase.policy.kind === "quorum";
      expect(decision.votes !== undefined, evaluationCase.name).toBe(quorum);
      if (decision.votes === undefined) continue;
      expect(decision.votes.map((item) => item.sourceNodeId), evaluationCase.name)
        .toEqual(evaluationCase.dispositions.map((item) => item.sourceNodeId));
    }
  });

  test("the census key is the ballot, not the disposition name", () => {
    for (const evaluationCase of corpus.evaluationCases) {
      const decision = decide(evaluationCase);
      if (decision.votes === undefined) continue;
      decision.votes.forEach((record, index) => {
        const arrival = evaluationCase.dispositions[index];
        if (arrival === undefined) throw new Error("census is longer than the arrival list");
        expect(record.verdict === "not-cast", `${evaluationCase.name}:${record.sourceNodeId}`)
          .toBe(arrival.vote === undefined);
        if (arrival.vote !== undefined) {
          expect(record.verdict).toBe(arrival.vote.verdict);
        }
      });
    }
    // Every non-voting disposition the corpus names really does arrive without a
    // ballot somewhere in the corpus, and is recorded not-cast.
    for (const disposition of corpus.vocabulary.nonVotingDispositions) {
      const witness = corpus.evaluationCases.find((item) =>
        item.policy.kind === "quorum" &&
        item.dispositions.some((entry) => entry.disposition === disposition));
      expect(witness, disposition).toBeDefined();
    }
  });

  test("a not-cast record carries exactly sourceNodeId and verdict", () => {
    expect(corpus.voteCensus.upstreamMayNeverCastNotCast).toBe(true);
    expect(corpus.vocabulary.decisionOnlyVerdicts).toEqual(["not-cast"]);
    let seen = 0;
    for (const evaluationCase of corpus.evaluationCases) {
      for (const record of decide(evaluationCase).votes ?? []) {
        if (record.verdict !== "not-cast") continue;
        seen += 1;
        expect(Object.keys(record).sort()).toEqual(["sourceNodeId", "verdict"]);
      }
    }
    expect(seen).toBeGreaterThan(0);
    // An upstream can never cast it: the carrier validator rejects the member.
    expect(validateBarrierVote(vote("not-cast")).valid).toBe(false);
    expect(corpus.vocabulary.voteRecordVerdicts)
      .toEqual([...corpus.vocabulary.verdicts, "not-cast"]);
  });

  test("a failed arrival that cast no ballot is recorded not-cast", () => {
    // The revision-2 amendment: `failed` is a cast disposition only when a
    // ballot said `reject`. An upstream execution failure produces no ballot.
    const policy = validateBarrierPolicy({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind: "quorum",
      quorum: { accepts: 1, countAbstainAsParticipant: true },
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    if (!policy.valid) throw new Error("policy must be valid");
    const decision = evaluateIntegratedBarrier(policy.policy, "gate", [
      { sourceNodeId: "a", disposition: "succeeded", vote: (validateBarrierVote(vote("accept")) as { vote: BarrierVote }).vote },
      { sourceNodeId: "b", disposition: "failed" },
    ]);
    expect(decision.failed).toBe(1);
    expect(decision.failedIds).toEqual(["b"]);
    expect(decision.votes).toEqual([
      { sourceNodeId: "a", verdict: "accept" },
      { sourceNodeId: "b", verdict: "not-cast" },
    ]);
  });

  test("evidence is retained only as its canonical hash", () => {
    expect(corpus.hashContract.evidenceHash).toBe("sha256(utf8(canonicalSerialize(evidence)))");
    let checked = 0;
    for (const evaluationCase of corpus.evaluationCases) {
      const decision = decide(evaluationCase);
      decision.votes?.forEach((record, index) => {
        const arrival = evaluationCase.dispositions[index];
        const evidence = arrival?.vote?.evidence;
        if (arrival?.vote === undefined || !Object.hasOwn(arrival.vote, "evidence")) {
          expect(record.evidenceHash, evaluationCase.name).toBeUndefined();
          return;
        }
        checked += 1;
        expect(record.evidenceHash, evaluationCase.name).toBe(canonicalHash(evidence));
        expect(JSON.stringify(record)).not.toContain("citation");
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("percentage arithmetic never computes a floating-point ratio", () => {
    expect(corpus.satisfactionArithmetic.percentage)
      .toBe("satisfied iff succeeded * 10000 >= total * basisPoints, both exact safe integers");
    const validated = validateBarrierPolicy({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind: "percentage",
      basisPoints: 3333,
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    if (!validated.valid) throw new Error("policy must be valid");
    // 1/3 is not representable in binary floating point; the exact products are.
    const arrivals: BarrierArrival[] = [
      { sourceNodeId: "a", disposition: "succeeded" },
      { sourceNodeId: "b", disposition: "failed" },
      { sourceNodeId: "c", disposition: "failed" },
    ];
    expect(evaluateIntegratedBarrier(validated.policy, "gate", arrivals).satisfied).toBe(true);
    expect(1 / 3 >= 3333 / 10_000).toBe(true);
    const strict = validateBarrierPolicy({
      apiVersion: INTEGRATED_BARRIER_API_VERSION,
      kind: "percentage",
      basisPoints: 3334,
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    if (!strict.valid) throw new Error("policy must be valid");
    expect(evaluateIntegratedBarrier(strict.policy, "gate", arrivals).satisfied).toBe(false);
  });

  test("abstained and unknown are never synthesized for a non-quorum barrier", () => {
    for (const evaluationCase of corpus.evaluationCases) {
      if (evaluationCase.policy.kind === "quorum") continue;
      const decision = decide(evaluationCase);
      for (const disposition of corpus.vocabulary.quorumOnlyDispositions) {
        const field = corpus.vocabulary.dispositionToCountField[disposition] as string;
        expect((decision as unknown as Record<string, number>)[field], evaluationCase.name).toBe(0);
      }
    }
  });

  test("a malformed vote is never coerced", () => {
    const malformed: readonly unknown[] = [
      undefined,
      null,
      "accept",
      [],
      {},
      { kind: "BarrierVote", verdict: "accept" },
      { apiVersion: INTEGRATED_BARRIER_API_VERSION, verdict: "accept" },
      { apiVersion: INTEGRATED_BARRIER_API_VERSION, kind: "BarrierVote" },
      vote("APPROVE"),
      vote("accept", { confidenceBasisPoints: 0 }),
      vote("accept", { confidenceBasisPoints: 10_001 }),
      vote("accept", { confidenceBasisPoints: 1.5 }),
      vote("accept", { confidence: 9000 }),
      vote("accept", { evidence: undefined }),
      { ...(vote("accept") as Record<string, unknown>), kind: "BarrierPolicy" },
      { ...(vote("accept") as Record<string, unknown>), apiVersion: "other/v1" },
    ];
    for (const value of malformed) {
      expect(validateBarrierVote(value).valid, JSON.stringify(value) ?? "undefined").toBe(false);
    }
    // The valid neighbours of those rejections really are accepted.
    for (const value of [
      vote("accept"),
      vote("reject", { confidenceBasisPoints: 1 }),
      vote("abstain", { confidenceBasisPoints: 10_000 }),
      vote("unknown", { evidence: null }),
      vote("accept", { evidence: { note: "ok" }, confidenceBasisPoints: 5000 }),
    ]) {
      expect(validateBarrierVote(value).valid, JSON.stringify(value)).toBe(true);
    }
  });
});
