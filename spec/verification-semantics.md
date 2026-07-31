# Verification, judge-panel, citation and reflection semantics v1alpha1

Status: **contract candidate**. `implementationClaim: false`. No TypeScript or
Python runtime implements this contract. Freezing this file grants no verifier,
judge-panel, citation-verification, reflection, quorum or unknown-state
capability claim. `D11-TS-VERIFY-041` and `D11-PY-VERIFY-042` remain unstarted,
and `D11-VERIFY-CONFORMANCE-043` has no cross-language join.

The normative corpus is [`conformance/verification.case.json`](conformance/verification.case.json)
and its executable oracle is
[`conformance/verification.validate.mjs`](conformance/verification.validate.mjs).

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**
and **MAY** are normative.

## 1. Scope

Section 17 of the master plan requires a versioned rubric, a bounded reflection
node, adversarial and perspective-diverse verification, judge panels with
synthesis, citation verification, and a verification conformance corpus. Section
3 of the plan body states the single property the whole workstream exists to
protect:

> Insufficient quorum becomes unknown or a human gate, never an implicit pass.

This document freezes:

- the content-addressed `Rubric`, its ordered criteria, severities, evidence and
  citation requirements, ceilings, independence policy, and deprecation rules;
- the `VerifierVerdict` ballot, its four-member verdict vocabulary, and the
  deterministic five-rung fold from criterion outcomes to a ballot verdict;
- the adversarial refutation default and the distinct missing-evidence rule;
- the eight-member lens vocabulary;
- maker/verifier identity and context independence, the original-evidence rule,
  and the closed six-member seat-exclusion vocabulary;
- the complete panel census, in which no ballot may be filtered before the gate;
- the two-stage resolution — an explicit quorum floor, then threshold arithmetic
  that is bit-identical to the integrated barrier's — the partition of the
  eleven barrier reason codes into three evidence classes, and the closed
  four-member resolution set in which no member is an implicit pass;
- candidate freezing, exact-integer score normalization, competition ranking,
  the closed six-rung tie-break ladder, and cited-only synthesis grafting;
- citation claims, the four-member outcome vocabulary, the eleven-member defect
  vocabulary, and the rule that an unreachable source and an unsupportive
  source are different outcomes;
- rubric-bound bounded reflection, its chain rule, its six-member stop-reason
  vocabulary, and the never-silently-edit rule;
- the `PanelDecision` durable document, its domain-separated identity, and
  zero-rejudge replay; and
- exactly how all of the above composes with the frozen integrated barrier
  contract.

This document does **not** freeze: provider or model invocation of any kind,
wall-clock timing, human-approval resumption authority (`D9-APPROVAL-077`),
budget accounting (`D10-BUDGET-SPEC-035` owns the units this contract only
bounds), network citation retrieval, Explorer projections, or any native API
surface. Nothing here may be cited as evidence for those tasks.

## 2. Machine-contract manifest

These files form one versioned contract set. An implementation MUST NOT claim
the contract by implementing a subset.

| Surface | Machine artifact |
| --- | --- |
| Versioned rubric | [`rubric.schema.json`](rubric.schema.json) |
| Single retained ballot | [`verdict.schema.json`](verdict.schema.json) |
| Durable panel decision | [`judge-panel.schema.json`](judge-panel.schema.json) |
| Cited claim and its verification | [`citation-claim.schema.json`](citation-claim.schema.json) |
| Bounded reflection record | [`reflection-record.schema.json`](reflection-record.schema.json) |
| Normative corpus | [`conformance/verification.case.json`](conformance/verification.case.json) |
| Executable oracle | [`conformance/verification.validate.mjs`](conformance/verification.validate.mjs) |

Every carrier declares

```text
apiVersion: "graphengineering.reacher-z.github.io/verification/v1alpha1"
```

and a `kind` discriminator. Objects are exact: unknown members, duplicates and
explicit null optionals are invalid. Omission, not null, selects optional
behavior. Integers are finite mathematical integers inside the portable JSON
safe-integer range, so JSON `1.0` is integer one in both languages while
booleans are never integers.

The `apiVersion` value is deliberately **not** the barrier contract's
`.../barrier/v1alpha1`. Section 13 explains the consequence.

## 3. Identity and hashing

`frame(s)` is `uint32be(byteLength(utf8(s))) || utf8(s)` and
`canonicalSerialize` is the existing canonical Graph IR serialization — object
keys in ascending Unicode code-point order, no insertion-order dependence, no
locale comparison. Both are reused verbatim from
[`integrated-barrier-semantics.md`](integrated-barrier-semantics.md); this
contract introduces no second framing construction. Explicit byte lengths make
concatenation injective, so no field boundary can be forged by crafted content.

All digests are lowercase hex SHA-256.

| Identity | Framed preimage |
| --- | --- |
| `rubricHash` | `frame("graphengineering.rubric.v1alpha1")`, `frame(canonicalSerialize(rubric without rubricHash))` |
| `verdictHash` | `frame("graphengineering.verifier-verdict.v1alpha1")`, `frame(runId)`, `frame(verifierId)`, `frame(canonicalSerialize(verdict without verdictHash))` |
| `claimHash` | `frame("graphengineering.claim.v1alpha1")`, `frame(canonicalSerialize(claim without claimHash))` |
| `panelDecisionId` | `frame("graphengineering.panel-decision.v1alpha1")`, `frame(runId)`, `frame(decimal(graphRevision))`, `frame(panelNodeId)`, `frame(canonicalSerialize(document without panelDecisionId))` |
| `reflectionId` | `frame("graphengineering.reflection.v1alpha1")`, `frame(runId)`, `frame(nodeId)`, `frame(decimal(attempt))`, `frame(canonicalSerialize(record without reflectionId))` |
| `sourceDigest` | `sha256(utf8(frozen source text))`, unframed |
| `excerpt.digest` | `sha256(utf8(code-point slice of the frozen source text))`, unframed |

`panelDecisionId` uses the same five-part construction as the barrier's
`decisionId` with a different domain string, so a barrier decision can never be
adopted as a panel decision and the reverse is equally impossible.

`verdictHash` binds `runId` and `verifierId`. A ballot therefore cannot be
transplanted between runs or reattributed to another verifier without changing
its identity, and because the panel census stores only `verdictHash`, the
census inherits that binding.

`sourceDigest` and `excerpt.digest` are unframed because they digest opaque
source bytes rather than a structured record with forgeable field boundaries.

## 4. The versioned rubric

A `Rubric` is a closed, content-addressed contract. Free-form review cannot
satisfy a release gate: a panel MUST reference a rubric by `rubricId`,
`rubricVersion` and `rubricHash`, and every counted ballot MUST carry the same
`rubricHash`.

```text
Rubric {
  apiVersion, kind: "Rubric"
  rubricId: string                       // stable across versions
  rubricVersion: string                  // exact semantic version
  rubricHash: sha256                     // over the document without this member
  subjectSchemaHash: sha256              // the claim/output schema under review
  mode: "verification" | "comparison"
  criteria: Criterion[]                  // ordered, >= 1, unique ids
  decision: Decision
  citation?: CitationPolicy              // required iff any criterion requires citation
  reflection?: ReflectionPolicy
  independence: Independence
  ceiling: Ceiling
  deprecation: Deprecation
}

Criterion {
  criterionId: string
  lens: <one of the eight lenses>
  severity: "blocking" | "major" | "minor" | "advisory"
  evidenceRequired: boolean
  citationRequired: boolean
  refutationDefault: boolean
  basis: "deterministic" | "model-judgment"
}

Decision {
  quorum: { minimumCast: integer 1.., countAbstainAsCast: boolean,
            countUnknownAsCast: boolean }
  threshold: { kind: "all"|"minimum"|"percentage"|"quorum",
               minimum?, basisPoints?, accepts?, countAbstainAsParticipant? }
  onInsufficientQuorum: "unknown" | "human"
  onThresholdUnsatisfied: "reject" | "unknown" | "human"
  aggregation?: "sum-of-normalized" | "borda-count"   // iff mode == comparison
  tieBreak?: { ladder: <rung>[], onUnresolved: "unknown" | "human" }
}

Ceiling {
  maxVerifiers, maxRevisions, maxUnits: integer 1..
  modelTierCeiling: string
  capabilities: string[]                 // ascending code-point order, unique
}

Deprecation {
  supersedes?: string                    // rubricId@rubricVersion
  deprecated: boolean
  migrationNote?: string                 // required iff deprecated is true
}
```

Rules:

1. `criteria` is non-empty, its `criterionId` values are unique, and its order
   is normative: the ballot fold and the reflection issue list both visit it in
   declaration order.
2. `threshold` declares exactly the member its `kind` requires — `minimum` for
   `minimum`, `basisPoints` for `percentage`, `accepts` and
   `countAbstainAsParticipant` for `quorum`, none for `all`. A member belonging
   to a different kind is invalid. This is the barrier policy's cardinality rule
   restated for the same four kinds.
3. `mode: "comparison"` REQUIRES both `decision.aggregation` and
   `decision.tieBreak`; `mode: "verification"` FORBIDS both. A verification
   panel judges one subject and has nothing to rank.
4. `citation` is present if and only if some criterion sets
   `citationRequired: true`.
5. `deprecated: true` REQUIRES `migrationNote`, and a deprecated rubric MUST NOT
   be used to reach a `pass` resolution. A deprecated rubric may still record a
   `reject`, `unknown` or `human` resolution, because withdrawing a rubric must
   not retroactively convert an open finding into an accepted one.
6. `onInsufficientQuorum` and `onThresholdUnsatisfied` are REQUIRED and have no
   default. Neither vocabulary contains a pass member. A silently defaulted
   resolution is exactly the implicit pass this contract forbids.
7. `rubricHash` MUST equal the section 3 digest of the document with
   `rubricHash` removed. A rubric that mis-states its own hash is invalid, so
   `rubricVersion` alone can never be trusted as identity.

### 4.1 Lenses

The lens vocabulary is closed and has exactly eight members:

`correctness`, `security`, `performance`, `reproducibility`, `compatibility`,
`operability`, `source-quality`, `evidence-citation`.

A panel is *perspective-diverse* when its counted seats cover at least two
distinct lenses. `Rubric.independence.minimumDistinctLenses` declares the floor;
a panel whose counted seats cover fewer distinct lenses fails the quorum floor
of section 8 exactly as an insufficient ballot count does, and therefore
resolves to `unknown` or `human` and never to `pass`. Diversity is evidence, not
decoration: a panel of five identical lenses is one perspective repeated.

## 5. The verifier verdict

A `VerifierVerdict` is one retained ballot.

```text
VerifierVerdict {
  apiVersion, kind: "VerifierVerdict"
  verdictHash: sha256
  runId, verifierId: string
  lens: <one of the eight lenses>
  rubricId, rubricVersion, rubricHash
  subjectId: string
  subjectEvidenceHash: sha256            // the ORIGINAL evidence
  verdict: "pass" | "reject" | "abstain" | "unknown"
  confidenceBasisPoints?: integer 1..10000
  abstainReason?: string                 // present iff verdict == "abstain"
  criterionOutcomes?: CriterionOutcome[] // absent iff verdict == "abstain"
  findings: Finding[]                    // ordered; may be empty
  evidenceRefs: string[]                 // ordered, unique
  separationProof?: SeparationProof
  scores?: CandidateScore[]              // present iff the rubric mode is comparison
}

CriterionOutcome {
  criterionId: string
  outcome: "pass" | "reject" | "unknown"
  supportEstablished: boolean
  evidenceRefs: string[]
  basis: "deterministic" | "model-judgment"
}

Finding { criterionId, severity, detail, evidenceRefs }
```

`confidenceBasisPoints` is an optional integer in `1..10000`, matching
`BarrierVote.confidenceBasisPoints` exactly so that section 13's projection is
the identity on that member.

### 5.1 The ballot vocabulary is four members

`pass`, `reject`, `abstain`, `unknown`. There is no fifth member. `not-cast`
belongs to the census of section 7 and can never appear in a ballot: a ballot
that exists was cast by definition.

### 5.2 Criterion outcome rules

For every criterion in the rubric there MUST be exactly one outcome, in rubric
declaration order, unless the ballot verdict is `abstain`.

1. `outcome: "pass"` REQUIRES `supportEstablished: true`. A verifier may not
   pass a criterion it did not establish.
2. A criterion with `evidenceRequired: true` whose outcome carries an empty
   `evidenceRefs` MUST have `outcome: "unknown"`. Missing required evidence is
   an admission of ignorance, not a finding.
3. A criterion with `refutationDefault: true`, non-empty `evidenceRefs` and
   `supportEstablished: false` MUST have `outcome: "reject"`. This is the
   adversarial default: the verifier was asked to refute, it looked, and it did
   not establish support, so it refutes.
4. `CriterionOutcome.basis` MUST equal the rubric criterion's `basis`. A
   deterministic check MUST NOT be answered by model judgment and a
   model-judgment criterion MUST NOT be reported as deterministic. This is the
   §17.2 separation of deterministic checks from model judgment, made
   mechanical.

Rules 2 and 3 are deliberately distinct and their difference is the point.
Missing evidence yields `unknown`; present evidence that fails to establish
support yields `reject`. Collapsing them in either direction destroys the
distinction the contract exists to keep.

### 5.3 The fold from outcomes to a ballot verdict

The ballot verdict is a deterministic function of the criterion outcomes,
evaluated as an ordered ladder. The first rung that matches decides.

```text
1. some criterion with severity "blocking"  and outcome "reject"  -> reject
2. some criterion with severity "blocking"  and outcome "unknown" -> unknown
3. some criterion with evidenceRequired true and outcome "unknown"-> unknown
4. some criterion with severity "major"     and outcome "reject"  -> reject
5. otherwise                                                      -> pass
```

Rung order is normative and is not a formatting choice. Rung 3 precedes rung 4
because an evidence gap outranks a substantive finding: a panel that reports
`reject` while a required evidence source was never read is asserting more than
it verified. Rung 1 precedes rung 2 because a blocking refutation is a
conclusion, while a blocking evidence gap is an absence, and a conclusion that
was actually reached is the more informative answer.

`minor` and `advisory` criteria never move the ballot verdict on their own.
They are retained in `findings` and remain visible in the census.

`abstain` is not produced by the fold. A verifier abstains from the whole
rubric — for example because the subject is out of its lens's scope — and such a
ballot carries `abstainReason` and no `criterionOutcomes` at all.

### 5.4 Malformed ballots

A ballot that fails this section or its schema is the non-retryable node failure
`INVALID_VERIFIER_VERDICT` after exactly one attempt. It is never coerced to
`abstain`, never coerced to `unknown`, and never counted as a participant. This
mirrors `INVALID_BARRIER_VOTE` deliberately: a malformed ballot is a defect in
the verifier, not evidence about the subject.

## 6. Independence and isolation

```text
Independence {
  sameIdentityPermitted: boolean
  sharedContextPermitted: boolean
  evidenceSource: "original" | "maker-summary"
  separationProofRequired: boolean
  minimumDistinctLenses: integer 1..
}

SeparationProof { makerContextHash, verifierContextHash, evidenceSourceHash }
```

Makers and verifiers use isolated contexts, and verifiers inspect the original
evidence rather than the maker's summary of it. A seat is **excluded** when:

| Exclusion code | Condition |
| --- | --- |
| `MAKER_VERIFIER_IDENTITY_COLLISION` | `sameIdentityPermitted: false` and `verifierId == subject.makerIdentity` |
| `SHARED_CONTEXT_DENIED` | `sharedContextPermitted: false` and `makerContextHash == verifierContextHash` |
| `EVIDENCE_NOT_ORIGINAL` | `evidenceSource: "original"` and `evidenceSourceHash == subject.makerSummaryHash` |
| `SEPARATION_PROOF_ABSENT` | `separationProofRequired: true` and the ballot carries no `separationProof` |
| `RUBRIC_HASH_MISMATCH` | the ballot's `rubricHash` differs from the panel's |
| `CAPABILITY_DENIED` | the seat's declared capabilities are not a subset of `Ceiling.capabilities` |

The vocabulary is closed at exactly six members.

### 6.1 Exclusion is verdict-independent

**Exclusion MUST be decidable from seat and ballot provenance alone.** The
inputs are `verifierId`, `lens`, `rubricHash`, `separationProof` and the
declared capability set. Exclusion MUST NOT read `verdict`,
`criterionOutcomes`, `findings`, `confidenceBasisPoints`, `scores` or
`evidenceRefs`.

This is the rule that stops "exclude the dissenter". It is mechanically
falsifiable and the corpus proves it by re-execution: for every excluded seat,
substituting each of the four ballot verdicts in turn MUST leave the exclusion
decision and its code unchanged.

An excluded seat is retained in the census with `participation: "excluded"` and
`verdict: "not-cast"`, because under this rule no ballot content was ever
consumed from it.

### 6.2 Collisions discovered after the tally

A `MAKER_VERIFIER_IDENTITY_COLLISION` that is only discovered after a ballot has
been counted MUST NOT be repaired by removing the ballot. Removing it would be
the filtering §17.3 forbids, and it would let a panel improve its own tally by
disqualifying seats after seeing them. Instead the whole panel resolution
becomes `unknown` or `human` per `onInsufficientQuorum`, the ballot stays
counted in the census, and the decision document records
`postTallyCollision: true`.

## 7. The census retains everything

`PanelDecision.seats` holds exactly one record per **declared** seat, in
declared seat order. Nothing is filtered, sorted, deduplicated or dropped before
the gate.

```text
VerifierSeatRecord {
  verifierId: string
  lens: <one of the eight lenses>
  participation: "counted" | "excluded" | "missing" | "timed_out"
  verdict: "pass" | "reject" | "abstain" | "unknown" | "not-cast"
  exclusionCode?: <one of the six>       // present iff participation == "excluded"
  confidenceBasisPoints?: integer 1..10000
  verdictHash?: sha256
}
```

1. `verdict == "not-cast"` **if and only if** `participation != "counted"`.
2. A `not-cast` record's key set MUST be exactly `verifierId`, `lens`,
   `participation`, `verdict` and, when excluded, `exclusionCode`. It MUST NOT
   carry `confidenceBasisPoints` and MUST NOT carry `verdictHash`, because there
   is no ballot from which either could be derived; materializing one would be
   inventing the ballot the member exists to deny. This mirrors the barrier's
   `not-cast` key-set rule exactly.
3. A `counted` record MUST carry `verdictHash`. "All votes are retained" is
   unenforceable if the census cannot address the vote it counts.
4. `exclusionCode` is present if and only if `participation == "excluded"`.
5. `seats` has unique `verifierId` values. An empty census is unreachable
   through a compiled panel node, exactly as an input-free barrier is
   unreachable through the compiler, but it remains defined for direct
   evaluator conformance and yields `NO_ITEMS`.

`tally` counts the census by census verdict and by participation, and every
count MUST be recomputable from `seats` alone. The six census counts MUST sum to
the seat count. A decision whose tally disagrees with its census is
`PANEL_CENSUS_INCOMPLETE`.

## 8. Two-stage resolution

Resolution is two ordered stages. Stage 1 asks whether enough evidence exists to
decide at all. Stage 2 asks what the evidence decides. Stage 1 can never produce
a pass and can never produce a reject.

### 8.1 Stage 1 — the quorum floor

```text
castCount = |{seat : participation == "counted" and verdict in {pass, reject}}|
          + (countAbstainAsCast ? |counted abstain| : 0)
          + (countUnknownAsCast ? |counted unknown| : 0)

distinctCountedLenses = |{seat.lens : participation == "counted"}|

quorumSatisfied = castCount >= minimumCast
              and distinctCountedLenses >= minimumDistinctLenses
```

`countUnknownAsCast: true` is permitted but SHOULD NOT be used: an `unknown`
ballot is a report that the verifier could not decide, and counting it as
participation converts an absence of evidence into evidence of participation.
The member exists so that the choice is explicit and auditable rather than
implicit.

### 8.2 Stage 2 — threshold arithmetic, identical to the barrier

Let `total` be the seat count and let `succeeded`, `failed`, `missing`,
`timedOut`, `abstained` and `unknown` be the projected disposition counts of
section 13.1. The arithmetic is transcribed from
[`integrated-barrier-semantics.md`](integrated-barrier-semantics.md) without a
single change:

- `total == 0` is unsatisfied with reason `NO_ITEMS`.
- `all`: satisfied iff `succeeded == total`; `ALL_SUCCEEDED` or
  `ALL_NOT_SUCCEEDED`.
- `minimum`: if `minimum > total`, unsatisfied with `MINIMUM_EXCEEDS_TOTAL`;
  otherwise satisfied iff `succeeded >= minimum`, `MINIMUM_MET` or
  `MINIMUM_NOT_MET`.
- `percentage`: satisfied iff `succeeded * 10000 >= total * basisPoints`;
  `PERCENTAGE_MET` or `PERCENTAGE_NOT_MET`. Both products stay exact safe
  integers; no floating-point ratio is ever computed.
- `quorum`: `participants = total - (countAbstainAsParticipant ? 0 : abstained)`.
  If `accepts > participants`, unsatisfied with
  `QUORUM_EXCEEDS_PARTICIPANTS`; otherwise satisfied iff `succeeded >= accepts`,
  `QUORUM_MET` or `QUORUM_NOT_MET`. `unknown` always counts as a participant and
  never as an accept.

The eleven reason codes are the barrier's eleven, unchanged and not extended.

### 8.3 The reason codes partition into three evidence classes

| Class | Reason codes |
| --- | --- |
| `satisfied` | `ALL_SUCCEEDED`, `MINIMUM_MET`, `PERCENTAGE_MET`, `QUORUM_MET` |
| `unsatisfied` | `ALL_NOT_SUCCEEDED`, `MINIMUM_NOT_MET`, `PERCENTAGE_NOT_MET`, `QUORUM_NOT_MET` |
| `insufficient` | `NO_ITEMS`, `MINIMUM_EXCEEDS_TOTAL`, `QUORUM_EXCEEDS_PARTICIPANTS` |

The partition is total, disjoint, and covers exactly eleven codes as 4 + 4 + 3.

The `insufficient` class is the load-bearing one. Its three codes all mean the
policy could not be evaluated against the evidence present — the threshold
exceeded what was available — rather than that the evidence answered no. The
barrier treats all eight non-satisfied codes identically because every one of
its `onUnsatisfied` members is already non-passing. A verification panel cannot,
because `reject` is a substantive claim about the subject and asserting it from
an evidence gap is a fabricated finding.

Worked instance: five seats all abstain, `kind: "quorum"`, `accepts: 3`,
`countAbstainAsParticipant: false`. Then `participants = 0`, `accepts > 0`, and
the code is `QUORUM_EXCEEDS_PARTICIPANTS`. Nobody said no. A contract that
mapped this to `reject` would put words in five abstaining verifiers' mouths.

### 8.4 Resolution

```text
undecidable = (quorumSatisfied == false)
           or (reasonClass == "insufficient")
           or (postTallyCollision == true)

resolution = undecidable                ? decision.onInsufficientQuorum
           : thresholdSatisfied == false ? decision.onThresholdUnsatisfied
           : deprecated == true          ? decision.onInsufficientQuorum
           :                               "pass"
```

The ladder is ordered and each rung earns its place. `undecidable` collects the
three ways the panel could not reach a finding at all — too little evidence, too
few perspectives, or a §6.2 collision discovered after the tally — and every one
of them routes to a vocabulary with no pass and no reject. A deprecated rubric is
checked *after* the threshold, so a withdrawn rubric can still record the
`reject` it earned and only its `pass` is withheld.

The resolution vocabulary is closed at four members and **no member is an
implicit pass**:

| `resolution` | `terminal` | Binds an output |
| --- | --- | --- |
| `pass` | `succeeded` | yes |
| `reject` | `failed` | no |
| `unknown` | `unknown` | no |
| `human` | `awaiting_human` | no |

The central safety invariant, stated once so that it can be deleted once and
caught once:

> `resolution == "pass"` **implies** `quorumSatisfied == true` **and**
> `reasonClass == "satisfied"` **and** `postTallyCollision == false` **and**
> `Rubric.deprecation.deprecated == false`.

### 8.5 Only a pass binds an output

A panel node whose resolution is not `pass` NEVER succeeds and NEVER binds an
output. The decision document is still emitted as the `VerificationDecided`
event, exactly as an unsatisfied barrier still emits its decision document.

- `reject` — the node fails with the non-retryable `VERIFICATION_REJECTED` after
  zero further attempts. Descendants inherit the existing `UPSTREAM_FAILED`
  zero-attempt terminal.
- `unknown` — the node settles with terminal status `unknown`. Descendants
  reachable only through it inherit `UPSTREAM_UNKNOWN`. The run does not fail
  solely because of it.
- `human` — the node settles with terminal status `awaiting_human`, emits
  `HumanInputRequested` carrying the decision document, schedules no descendant,
  and stops. Whether such a run may resume is `D9-APPROVAL-077` authority and is
  an explicit non-claim here.

This rule exists because of a concrete hazard. If a `reject` or `unknown` panel
node *succeeded* and bound its decision document as output, then at any `all`,
`minimum` or `percentage` barrier downstream it would contribute the `succeeded`
disposition — those barriers do not inspect upstream values. A rejected
verification would arrive at the gate indistinguishable from a passing one. Run
terminal precedence is the barrier's, unchanged: `failed`, `cancelled`,
`awaiting_human`, `unknown`, `succeeded`.

## 9. Judge panels and synthesis

A `mode: "comparison"` rubric compares candidates without erasing runners-up.

1. **Candidates are frozen before judging.** `PanelDecision.candidates` is an
   ordered list of `{candidateId, contentHash, frozenAtSequence}` with unique
   ids and pairwise distinct `contentHash` values. Every judge sees exactly this
   declared set. A ballot scoring a `candidateId` outside it, or omitting one
   inside it, is `CANDIDATE_SET_MUTATED`.
2. **Scores are normalized by exact integer arithmetic.** A judge declares its
   own `scaleMin < scaleMax` and a `rawScore` in `scaleMin..scaleMax`, and

   ```text
   normalizedBasisPoints = floor(((rawScore - scaleMin) * 10000) / (scaleMax - scaleMin))
   ```

   The numerator is non-negative, so floor and truncation agree and both
   languages produce the same integer. Floating-point normalization is
   forbidden.
3. **Ranking is standard competition ranking**, recomputed rather than
   asserted: `rank(i) = 1 + |{j : normalized(j) > normalized(i)}|`. Ties share
   the smaller rank and the following rank is skipped.
4. **Aggregation happens in code**, from the closed two-member set
   `sum-of-normalized` and `borda-count`, where a judge's Borda points for
   candidate `i` are `candidateCount - rank(i)`.
5. **Ties are retained and broken deterministically.** `decision.tieBreak.ladder`
   is a non-empty, duplicate-free, ordered subsequence of the closed six-rung
   vocabulary, applied in order until the leading group is a single candidate:

   | Rung | Comparison |
   | --- | --- |
   | `highest-minimum-score` | largest minimum normalized score across counted judges |
   | `highest-median-score` | largest doubled median (`2 x median` as an exact integer) |
   | `most-first-ranks` | largest count of `rank == 1` across counted judges |
   | `fewest-blocking-findings` | smallest count of `severity: "blocking"` findings across counted judges |
   | `earliest-declared-candidate` | smallest index in the frozen candidate list |
   | `lowest-content-hash` | smallest `contentHash` by ascending Unicode code point |

   `earliest-declared-candidate` and `lowest-content-hash` are total orders over
   a frozen candidate set, so a ladder ending in either can never reach
   `onUnresolved`. A rubric that refuses an arbitrary tiebreak omits both, and
   the corpus carries a witness of each shape.
6. **An unresolved tie is not a pick.** If the ladder is exhausted with more
   than one candidate leading, the resolution is `decision.tieBreak.onUnresolved`
   — `unknown` or `human` — and `selection` is absent. No pass.
7. **Synthesis grafts only cited strengths.** Each entry of
   `synthesis.grafts` carries `fromCandidateId`, `evidenceRef` and
   `excerptHash`. `fromCandidateId` MUST be a declared candidate and
   `evidenceRef` MUST appear in the `evidenceRefs` of at least one counted
   ballot. A graft that satisfies neither is `SYNTHESIS_UNCITED`. `synthesis` is
   present only when `resolution == "pass"`.
8. **The selection records everything.** `selection.candidateHashes` MUST equal
   the `contentHash` of every declared candidate in declaration order, and
   `selection.verdictHashes` MUST equal the `verdictHash` of every counted seat
   in census order. Dropping a runner-up hash or a dissenting ballot hash is
   `PANEL_CENSUS_INCOMPLETE`. The record of what lost is part of the record of
   what won.

## 10. Citation verification

A `CitationClaim` binds a claim span to sources. Normal CI uses frozen local
sources; the corpus declares `networkVerification: "disabled"` and every
verification records `networkUsed: false`.

```text
CitationClaim {
  apiVersion, kind: "CitationClaim"
  claimHash: sha256
  claimId: string
  claimSpan: { documentHash, startCodePoint, endCodePoint }
  citations: Citation[]                  // ordered, unique citationId, >= 1
}

Citation {
  citationId: string
  locator: { kind: "frozen-local"|"url"|"artifact"|"document", value: string }
  declaredVersion: string
  contentDigest: sha256
  excerpt: { startCodePoint, endCodePoint, digest }
  authority: { declared: string, verified: boolean }
  retrievedAtSequence: integer >= 0      // a durable sequence number, never a clock
}

CitationVerification {
  citationId: string
  outcome: "supported" | "contradicted" | "insufficient" | "inaccessible"
  supportMode?: "direct" | "inferred"    // present iff outcome == "supported"
  defects: <defect code>[]               // ordered, unique
  networkUsed: boolean
}
```

`retrievedAtSequence` is a durable event sequence number, never a wall-clock
time. Freshness is expressed as a comparison of sequence numbers and
`declaredVersion`, so a conformance case can never depend on when it ran.

### 10.1 Outcomes are four, and existence is not support

The outcome vocabulary is closed at exactly four members and the distinctions
between them are normative:

- `supported` — the source exists, is reachable, its digest matches, and its
  excerpt entails the claim. `supportMode` distinguishes `direct` support from
  `inferred` support, and it is present only here.
- `contradicted` — the source exists and is reachable, and its content
  contradicts the claim. Equivalent to `CONTRADICTED_BY_SOURCE` being present.
- `insufficient` — **the source exists and is reachable but does not support the
  claim.** A citation that resolves and says nothing relevant is not a missing
  citation, and reporting it as one hides the more dangerous failure: a real
  source cited for something it never said.
- `inaccessible` — the source could not be resolved or read at all. Equivalent
  to `SOURCE_NOT_FOUND` or `SOURCE_UNREACHABLE` being present.

The two directions are both forbidden and both tested:
`SOURCE_NOT_FOUND` and `SOURCE_UNREACHABLE` MUST NOT appear with `insufficient`
or `contradicted`; `EXCERPT_NOT_IN_SOURCE`, `CONTRADICTED_BY_SOURCE`,
`DIGEST_MISMATCH`, `STALE_VERSION`, `CITATION_LAUNDERING`,
`AUTHORITY_UNVERIFIED` and `EXCERPT_LIMIT_EXCEEDED` MUST NOT appear with
`inaccessible`. `outcome == "supported"` REQUIRES an empty `defects` list.

### 10.2 The defect vocabulary is eleven members

`SOURCE_NOT_FOUND`, `SOURCE_UNREACHABLE`, `FABRICATED_LOCATOR`,
`DIGEST_MISMATCH`, `STALE_VERSION`, `EXCERPT_NOT_IN_SOURCE`,
`CONTRADICTED_BY_SOURCE`, `CIRCULAR_REFERENCE`, `CITATION_LAUNDERING`,
`AUTHORITY_UNVERIFIED`, `EXCERPT_LIMIT_EXCEEDED`.

Detection is deterministic against the frozen source registry, which declares
for each source an `sourceId`, `text`, `version`, `reachable`, `sourceKind`
(`primary` or `secondary`), an optional `restates` edge to another `sourceId`,
and an optional `derivedFromRunId`.

| Defect | Deterministic condition |
| --- | --- |
| `SOURCE_NOT_FOUND` | `locator.value` is absent from the registry |
| `FABRICATED_LOCATOR` | absent from the registry **and** `locator.kind == "frozen-local"`; a local source that must exist by construction and does not was invented |
| `SOURCE_UNREACHABLE` | registry hit with `reachable: false` |
| `DIGEST_MISMATCH` | `contentDigest != sha256(utf8(source.text))` |
| `STALE_VERSION` | `declaredVersion != source.version` |
| `EXCERPT_NOT_IN_SOURCE` | `excerpt.digest != sha256(utf8(code-point slice))`, or the span is out of range or non-increasing |
| `CONTRADICTED_BY_SOURCE` | the excerpt is in the source's declared `contradicts` set for this claim |
| `CIRCULAR_REFERENCE` | `source.derivedFromRunId == runId`, or the `restates` chain revisits a source |
| `CITATION_LAUNDERING` | the `restates` chain terminates without reaching a `sourceKind: "primary"` source |
| `AUTHORITY_UNVERIFIED` | `citation.authority.verified == false` and the rubric sets `authorityRequired: true` |
| `EXCERPT_LIMIT_EXCEEDED` | the excerpt spans more than `citation.maxExcerptCodePoints` code points |

`FABRICATED_LOCATOR` always accompanies `SOURCE_NOT_FOUND` and never appears
alone: fabrication is a sharper reading of an absence, not a separate absence.
`CIRCULAR_REFERENCE` and `CITATION_LAUNDERING` are mutually exclusive — a chain
either revisits a source or terminates, and it cannot do both.

`defects` is emitted in the vocabulary's declaration order above, so two
conforming implementations that find the same defects emit the same list.

Copyright and privacy limits are enforced by `maxExcerptCodePoints` and by the
rule that an over-limit excerpt is refused rather than truncated: truncating
would produce a digest that matches nothing and would silently change what was
cited.

### 10.3 A network verification reports its own availability honestly

`citation.networkVerification` is `"disabled"` or `"bounded"`. Under
`"disabled"`, a `url` locator is `SOURCE_UNREACHABLE` and `networkUsed` is
`false`; the verification is still emitted rather than skipped, and
`externalAvailabilityReported: true` records that the unreachability is a
property of the harness rather than of the source. No conformance case may set
`"bounded"`.

### 10.4 Citations bind back to criterion outcomes

For a criterion with `citationRequired: true`, over the outcomes of every
citation of its claim:

```text
1. any outcome "contradicted"                       -> criterion outcome "reject"
2. any outcome "insufficient" or "inaccessible"     -> criterion outcome "unknown"
3. all outcomes "supported"                         -> unconstrained by this rule
```

A criterion whose citations are not all supported and whose outcome is `pass` is
`CITATION_UNVERIFIED`. Rung 1 precedes rung 2 for the same reason as §5.3: a
contradiction is a conclusion and an inaccessible source is an absence.

## 11. Bounded, rubric-bound reflection

Reflection compares a producer output to the exact rubric and emits structured
issues, evidence, suggested changes, and a verdict. It is not open-ended
self-critique.

```text
ReflectionRecord {
  apiVersion, kind: "ReflectionRecord"
  reflectionId: sha256
  runId, nodeId: string
  rubricId, rubricVersion, rubricHash
  subjectHash: sha256                    // the exact output under review
  acceptedResultHash: sha256             // MUST equal subjectHash
  proposedResultHash?: sha256            // present iff verdict == "reject"
  attempt: integer 1..
  verdict: "pass" | "reject" | "unknown"
  issues: ReflectionIssue[]              // rubric criterion order
  deterministicChecks: [{criterionId, outcome: "pass"|"fail"|"unknown"}]
  modelJudgment: { sameModelPermitted: boolean, sameContextPermitted: boolean }
  ceiling: { revisionsUsed, revisionsMax, unitsUsed, unitsMax }
  stopped: boolean
  stopReason?: <one of six>              // present iff stopped == true
}
```

1. **The original output and rubric identity are preserved.** `subjectHash` and
   `rubricHash` are carried on every record of a chain, and `rubricHash` MUST be
   identical across the chain. A rubric that changes mid-chain is `RUBRIC_DRIFT`.
2. **The accepted result is never silently edited.** `acceptedResultHash` MUST
   equal `subjectHash` on every record. A revision is a *proposal*, carried
   separately as `proposedResultHash`, present if and only if the verdict is
   `reject`, and never equal to `subjectHash`.
3. **Deterministic checks are separated from model judgment.**
   `deterministicChecks` MUST cover exactly the rubric criteria whose `basis` is
   `deterministic`, in rubric declaration order, and no other. Every issue's
   `basis` MUST equal its criterion's `basis`.
4. **The same model and context are a declared permission.**
   `modelJudgment.sameModelPermitted` and `sameContextPermitted` MUST equal the
   rubric's `reflection.sameModelPermitted` and
   `independence.sharedContextPermitted`.
5. **Revisions and cost are capped.** `attempt` runs `1..revisionsMax + 1`;
   `revisionsUsed == attempt - 1`; `unitsUsed <= unitsMax`.
6. **Every attempt is recorded.** A chain's `attempt` values are exactly
   `1..k` contiguous and strictly increasing, and for every consecutive pair the
   successor's `subjectHash` equals the predecessor's `proposedResultHash`.
7. **It stops.** Exactly the last record of a chain has `stopped: true` with a
   `stopReason`; every earlier record has `stopped: false` and no `stopReason`.
   The stop-reason vocabulary is closed at six members with exact conditions:

   | `stopReason` | Condition |
   | --- | --- |
   | `converged` | `verdict == "pass"` |
   | `revision-limit` | `revisionsUsed == revisionsMax` |
   | `unknown-evidence` | `verdict == "unknown"` |
   | `no-progress` | this record's `proposedResultHash` equals some earlier record's `subjectHash` |
   | `ceiling-exhausted` | `unitsUsed == unitsMax` |
   | `cancelled` | the run was cancelled while the chain was open |

8. **Unknown surfaces.** A record with `verdict: "unknown"` MUST stop with
   `unknown-evidence` and MUST NOT carry a `proposedResultHash`. Missing
   required evidence terminates reflection; it does not license another lap.

A reflection chain that ends with any verdict other than `pass` MUST NOT be
consumed as an accepted result. The chain's terminal verdict projects onto a
panel seat by the identity `pass -> pass`, `reject -> reject`,
`unknown -> unknown`.

## 12. Replay and determinism

A committed `PanelDecision` is authoritative forever, under the barrier
contract's zero-rejudge rules applied verbatim to the panel node.

1. On resume, replay or fork the scheduler folds the durable history before
   scheduling. Every `VerificationDecided` event yields a committed decision.
2. A node with a committed decision MUST NOT be re-judged: no executor call, no
   provider call, no recomputation of the tally, no re-read of ballots, no
   second decision event.
3. Before adopting, the scheduler MUST compare the recorded `rubricHash` to the
   currently compiled rubric's hash. A mismatch is the non-retryable run failure
   `RUBRIC_DRIFT`, naming the node, the recorded hash and the current hash. It
   is never silently re-judged.
4. The scheduler MUST recompute `panelDecisionId` from the adopted document and
   the current `runId` / `graphRevision` / `panelNodeId`, and reject a mismatch
   as `DECISION_IDENTITY_MISMATCH`.
5. Two committed decision events for one node in one run is `DUPLICATE_DECISION`.
6. Conformance asserts a provider call count and an executor call count of
   exactly zero for every node with a committed decision, in both languages.

Fork inherits committed decisions from its parent lineage. Because
`panelDecisionId` binds `runId`, a parent decision adopted verbatim by a child
run is a `DECISION_IDENTITY_MISMATCH` rather than a silent reuse.

## 13. Composition with the frozen integrated barrier contract

[`integrated-barrier-semantics.md`](integrated-barrier-semantics.md) already
freezes quorum, abstention, the `BarrierVote` carrier, the five-member
`not-cast` census, and the closed `onUnsatisfied` resolution set. **The two
contracts compose without contradiction.** This section states exactly how, and
records the one place where the barrier contract is silent and this contract
therefore refuses to rely on it.

### 13.1 The projection is total and frozen

| Panel seat | Barrier disposition | `BarrierVoteRecord.verdict` |
| --- | --- | --- |
| `counted` + `pass` | `succeeded` | `accept` |
| `counted` + `reject` | `failed` | `reject` |
| `counted` + `abstain` | `abstained` | `abstain` |
| `counted` + `unknown` | `unknown` | `unknown` |
| `excluded` + `not-cast` | `missing` | `not-cast` |
| `missing` + `not-cast` | `missing` | `not-cast` |
| `timed_out` + `not-cast` | `timed_out` | `not-cast` |

Ballot verdict to `BarrierVote.verdict` is the total bijection
`pass -> accept`, `reject -> reject`, `abstain -> abstain`,
`unknown -> unknown`. The names differ on exactly one member because a
verification ballot passes a rubric while a barrier vote accepts an item; the
projection is explicit precisely so that the rename cannot become an accidental
identity.

`confidenceBasisPoints` projects unchanged (`1..10000`, optional in both). A
`not-cast` record projects to a key set of exactly `sourceNodeId` and `verdict`,
dropping `lens`, `participation` and `exclusionCode`, which satisfies the
barrier's key-set rule literally.

### 13.2 Stage 2 is bit-identical, and the corpus proves it

For every panel evaluation vector the corpus asserts that the panel's
`thresholdSatisfied` and `reasonCode` equal the values produced by the barrier's
frozen formulas over the projected disposition counts. The oracle transcribes
those formulas from the barrier document independently rather than importing the
panel implementation, so a divergence in either direction fails.

### 13.3 Stage 1 is a strictly earlier gate the barrier does not have

The quorum floor and the lens-diversity floor have no counterpart in
`IntegratedBarrierPolicy`. They are evaluated before stage 2 and their only
outputs are `unknown` and `human`. Because neither is a pass, adding stage 1
cannot weaken any barrier property; it can only refuse earlier. The barrier's
own `onUnsatisfied` set — `fail`, `unknown`, `human` — likewise contains no pass
member, so neither contract can produce an implicit pass on its own terms.

### 13.4 The rename of `fail` to `reject` is deliberate

The barrier's `fail` produces the node failure `BARRIER_NOT_SATISFIED`. The
panel's `reject` produces the node failure `VERIFICATION_REJECTED`. Both are
non-retryable and both give descendants `UPSTREAM_FAILED`, so the terminals are
the same; the codes differ because the causes differ and a shared name would
make a rejected verification indistinguishable from an unmet threshold in a log.
`onThresholdUnsatisfied` is otherwise the barrier's `onUnsatisfied` member for
member.

### 13.5 Two composition modes, and one that is forbidden

**Mode A — panel-internal tally (default).** The panel node runs both stages and
emits `PanelDecision`. If it is bound downstream to a quorum barrier it emits
one `BarrierVote` for the panel as a whole, projected from `resolution` by
`pass -> accept`, `reject -> reject`, `unknown -> unknown`. A `human` resolution
emits no vote at all: the panel node settles `awaiting_human`, schedules no
descendant, and stops, so the barrier is never reached. The barrier's
disposition vocabulary has no member for an awaiting-human upstream and needs
none, because the scheduler stops before a disposition could exist.

**Mode B — barrier-delegated tally.** Each verifier is its own graph node whose
output is a projected `BarrierVote`, and an integrated barrier performs stage 2.
Mode B is permitted only when all of the following hold:

1. the barrier's `kind` is `quorum`;
2. the barrier's threshold members equal the rubric's `decision.threshold`
   member for member;
3. the rubric's independence block can never exclude a seat — that is,
   `sameIdentityPermitted: true` and `separationProofRequired: false`; and
4. **no `PanelDecision` is emitted at all.** The barrier's `BarrierSatisfied`
   document is the record, so the tally is computed exactly once and there is no
   second document that could disagree with it. Every `PanelDecision` in this
   contract therefore describes a Mode A panel by construction, and the oracle
   rejects a `PanelDecision` that claims a delegated tally.

Condition 1 is not a preference. An `all`, `minimum` or `percentage` barrier does
not inspect upstream values, so a verifier node that *successfully executes* and
casts `reject`, `abstain` or `unknown` contributes the `succeeded` disposition.
The ballot would be ignored and a refutation would be counted as an acceptance.
**Binding a verifier node to a non-quorum barrier is forbidden by this
contract.** This is the sharpest implicit-pass hazard in the composition and it
is invisible from either document read alone.

Condition 3 exists because the barrier has no disposition member meaning "a
ballot was cast and then excluded on provenance grounds". Mapping it to
`missing` would record a cast ballot as `not-cast`, which the barrier forbids;
dropping it would be the filtering §17.3 forbids. Rather than invent a
reconciliation, this contract restricts Mode B to rubrics that cannot exclude.

**Forbidden.** A raw `VerifierVerdict` MUST NOT be placed where a `BarrierVote`
is expected. It carries a different `apiVersion` and a `kind` of
`VerifierVerdict`, so a quorum barrier rejects it as `INVALID_BARRIER_VOTE`
after exactly one attempt — loudly, at the vote boundary. Note the adjacent
consequence of the barrier's ownership rule: a `VerifierVerdict` placed in a
`barrier` node's *config* is **not** a claimed barrier policy, because ownership
is keyed on the barrier `apiVersion` alone, so the barrier pass emits no
diagnostic for it. That silence is a property of the barrier contract's
ownership rule, not a defect introduced here, and it is why the loud failure at
the vote boundary matters.

### 13.6 One place the barrier contract is silent

A quorum barrier whose upstream node **fails without producing a vote** has
disposition `failed` and no ballot. The barrier's census rule states that
`missing` and `timed_out` MUST be recorded as `not-cast` and that "a cast
disposition MUST NEVER be recorded as `not-cast`", but it does not say which of
those two sentences governs a `failed` entry with no ballot.

This is an under-specification in the barrier contract, not a conflict with it,
and this contract does not resolve it. Mode A never reaches it, because a panel
emits exactly one vote and only when it has a resolution. Mode B does not reach
it either, because Mode B requires a verifier node to produce a `BarrierVote`
whenever it executes; a verifier node that fails before producing one is out of
Mode B's scope and its handling remains the barrier lane's to decide. It is
recorded here so the next reader does not mistake the gap for a decision made
somewhere.

## 14. Closed vocabularies and codes

Every list below is closed. Adding a member is a contract revision, and the
oracle asserts corpus coverage of every member of every list as a hard failure.

| Vocabulary | Members |
| --- | --- |
| Lens | 8 |
| Severity | 4 — `blocking`, `major`, `minor`, `advisory` |
| Ballot verdict | 4 — `pass`, `reject`, `abstain`, `unknown` |
| Census verdict | 5 — the four plus `not-cast` |
| Participation | 4 — `counted`, `excluded`, `missing`, `timed_out` |
| Exclusion code | 6 |
| Criterion basis | 2 — `deterministic`, `model-judgment` |
| Criterion outcome | 3 — `pass`, `reject`, `unknown` |
| Threshold kind | 4 — the barrier's four |
| Reason code | 11 — the barrier's eleven |
| Reason class | 3 — `satisfied`, `unsatisfied`, `insufficient` |
| Resolution | 4 — `pass`, `reject`, `unknown`, `human` |
| Terminal | 4 — `succeeded`, `failed`, `unknown`, `awaiting_human` |
| Aggregation | 2 — `sum-of-normalized`, `borda-count` |
| Tie-break rung | 6 |
| Citation outcome | 4 — `supported`, `contradicted`, `insufficient`, `inaccessible` |
| Support mode | 2 — `direct`, `inferred` |
| Citation defect | 11 |
| Reflection stop reason | 6 |

Portable failure codes introduced by this contract, closed at eight:

`VERIFICATION_REJECTED`, `INVALID_VERIFIER_VERDICT`, `PANEL_CENSUS_INCOMPLETE`,
`RUBRIC_DRIFT`, `CANDIDATE_SET_MUTATED`, `SYNTHESIS_UNCITED`,
`CITATION_UNVERIFIED`, `PANEL_CEILING_EXCEEDED`.

Codes reused unchanged from other frozen contracts and **not** redefined here:
`DECISION_IDENTITY_MISMATCH`, `DUPLICATE_DECISION`, `UPSTREAM_FAILED`,
`UPSTREAM_UNKNOWN`, `INVALID_BARRIER_VOTE`, `BARRIER_NOT_SATISFIED`.

## 15. Conformance

A conforming pair MUST consume the literal corpus and prove:

1. rubric identity — `rubricHash` recomputed in each language, cardinality per
   threshold kind, `mode`/`tieBreak` cardinality, the citation-policy
   biconditional, and the deprecated-cannot-pass rule;
2. every criterion-outcome rule of §5.2 and every rung of the §5.3 fold,
   including rung precedence where two rungs both match;
3. exclusion of all six kinds, and the §6.1 verdict-independence property proved
   by re-execution under all four substituted verdicts;
4. the complete census: the `not-cast` biconditional, the `not-cast` key set,
   `verdictHash` presence on counted seats, and tally-equals-census;
5. stage 1 and stage 2 independently, the eleven reason codes, the 4+4+3 class
   partition, and the `MINIMUM_EXCEEDS_TOTAL` / `QUORUM_EXCEEDS_PARTICIPANTS` /
   one-below / at / one-above boundaries;
6. every resolution and terminal, and the §8.4 invariant that a pass implies a
   satisfied quorum, a satisfied reason class, and a non-deprecated rubric;
7. the §13.2 barrier equivalence for every evaluation vector, computed from
   independently transcribed barrier formulas;
8. exact-integer normalization, competition ranking, both aggregations, every
   tie-break rung, an unresolved ladder, and the full-hash selection rule;
9. all four citation outcomes, all eleven defect codes, both directions of the
   existence-is-not-support rule, and the §10.4 binding ladder;
10. reflection chain contiguity, the never-edit rule, all six stop reasons, and
    the deterministic/model-judgment separation; and
11. zero-rejudge replay with provider and executor call counts of exactly zero,
    plus `RUBRIC_DRIFT`, `DECISION_IDENTITY_MISMATCH` and `DUPLICATE_DECISION`.

Normal tests use deterministic fixtures. **No provider call, no model
invocation, no network access and no wall-clock read appears anywhere in this
contract or its corpus.** Every temporal quantity is a durable sequence number
or an injected monotonic value.

### 15.1 Mutation adequacy

A corpus that only re-derives one golden document is not evidence. The binding
obligation is stated as a mutation criterion:

> For every rejection rule the oracle implements, at least one vector must exist
> that isolates it — neutralizing that rule alone must make the shipped corpus
> fail.

Two mechanisms make this stronger here than a code-only check.

First, every rejection carries a unique **guard identifier**, and every negative
vector names the guard it targets rather than a portable failure code. The D4
audit found six rules whose deletion was invisible because a neighbouring rule
reported the same portable code. Keying negatives on guard identity removes that
shadowing entirely: two rules that report the same code are still distinct
guards and still require distinct vectors.

A consequence that must be stated because it is easy to get wrong: **a negative
vector against any carrier must reseal that carrier's identity.** Every identity
in §3 binds the whole document, so mutating a rubric, ballot, panel decision,
claim or reflection record without recomputing its digest tests the identity
rule and nothing else. Worse, a ballot identity is addressed by the census, the
selection and the delegated projection, so a ballot vector must re-key all
three. The oracle's vectors carry that whole cascade. Measured directly: with
the reseal omitted, a vector intended to prove that an unreachable source may
not be reported as merely unsupportive reports `T001` — a claim-hash drift —
instead of `T010`.

Second, the oracle is instrumented rather than inspected. Every guard records a
*touch* whenever its predicate is evaluated, so a guard that no fixture ever
reaches is a hard failure, and the oracle re-runs the whole corpus once per
guard with that guard neutralized and requires a failure each time. The measured
result is reported by `node spec/conformance/verification.validate.mjs` on every
run and is not a claim in prose.

The shipped measurement and the enumerated survivors are recorded in the corpus
under `guardSurvivability`, and the oracle asserts the observed survivor list
equals the disclosed list exactly. A newly deletable guard fails the gate, and
so does silently fixing a disclosed survivor without updating the disclosure.

Closed-vocabulary coverage, the frozen projection tables, the reason-class
partition and the failure-code-to-guard map are asserted rather than guarded.
They are not document rejection rules, so they carry no guard identifier and
need no negative vector; each is a hard assertion whose failure fails the gate.

### 15.2 The shipped measurement

`node spec/conformance/verification.validate.mjs` measures the campaign on every
run. As shipped:

> **179 guards, 177 held, 2 survivors.**

The two survivors are enumerated here rather than left for the next audit.
Both are implemented and both are evaluated by the positive corpus; only the
deletion test is blind, and in each case the reason is that the rule is a
theorem of two neighbouring rules rather than an independent constraint on a
document.

- **`Q010` — `thresholdSatisfied` if and only if `reasonClass == "satisfied"`.**
  `Q007` pins `thresholdSatisfied` to the recomputed arithmetic, `Q008` pins
  `reasonCode`, and `Q009` pins `reasonClass` to the frozen §8.3 partition.
  Together they leave no document that satisfies all three and violates `Q010`.
  Ordering `Q010` first would make it falsifiable and would make `Q009` the
  survivor instead; pinning the class to the frozen partition is the more
  load-bearing of the two, so `Q009` keeps the vector.
- **`X009` — exclusion is unchanged under every substituted ballot verdict.**
  This is a property of the oracle's own exclusion function rather than of any
  corpus document: it re-executes §6.1's decision under all four ballot
  verdicts and requires the answer to be invariant. No corpus mutation can make
  it fail while `recomputeExclusion` ignores the verdict, which is exactly the
  property it exists to protect. It becomes falsifiable the moment someone
  makes exclusion read ballot content, which is the only circumstance in which
  it matters.

Two structural choices in the oracle exist because of this measurement and are
worth stating, since both were forced by a guard that would otherwise have been
deletable:

1. **Sum rules are evaluated before recomputation rules.** A tally pinned to its
   census can never fail to sum, so `C008` and `C009` are checked first.
   The same reordering is applied to the citation family: every rule over the
   *declared* defect set and outcome runs before `T003` pins the defect set and
   `T005` derives the outcome from it.
2. **The barrier composition is corpus data, not an internal value.** Each panel
   vector declares the disposition list, vote-record verdicts, counts, id lists,
   `votesPresent`, `satisfied` and `reasonCode` it expects, so `B001`–`B009`
   compare two independently authored things. Comparing the oracle's projection
   against the oracle's own constants would have made eight guards
   unfalsifiable by construction.

### 15.3 Corpus inventory

10 rubrics, 38 retained ballots, 16 verification panels, 3 judge panels,
11 frozen citation sources, 15 citation claims, 6 reflection chains over
8 records, 1 Mode B delegation, 5 replay vectors, 7 schema negatives and
177 semantic negatives, over 90 positive documents validated against their own
schemas.

## 16. Non-claims

1. No TypeScript or Python runtime implements any part of this contract.
   `implementationClaim` is literally `false` in the corpus and in every
   summary the oracle prints.
2. No provider, model, network or wall clock participates. Nothing here is
   evidence that verification works against a real model.
3. Human-gate *resumption* is not specified. A `human` resolution suspends and
   stops; `D9-APPROVAL-077` owns what may follow.
4. Budget units are bounded by `Ceiling` but not accounted.
   `D10-BUDGET-SPEC-035` owns the ledger, and `PANEL_CEILING_EXCEEDED` is a
   refusal, not an accounting entry.
5. Isolation of maker and verifier *contexts* is expressed as a hash-inequality
   obligation on a declared proof. Enforcing real process, filesystem or network
   isolation is `D12` work and this contract cannot detect a forged proof.
6. Citation verification runs only against frozen local sources. No claim is
   made about real-world source availability, and `networkVerification:
   "bounded"` is defined but never exercised.
7. Explorer, exporter and CLI projections of votes and evidence are
   `D15-EXPLORER-060` work. §17.6's requirement that every vote survive the
   Explorer is not closed by this document.
8. The cross-language join `D11-VERIFY-CONFORMANCE-043` is unstarted. A single
   JavaScript oracle passing is contract-author evidence, not conformance
   evidence.
9. ~~This contract is not yet wired into `scripts/validate-fixtures.mjs`~~
   **Closed.** The corpus is now imported and executed by
   `scripts/validate-fixtures.mjs`, documented in `spec/README.md`, and listed
   in the task registry's expected artifacts, so `pnpm validate:fixtures`
   failing is now evidence about this corpus. Verified by corrupting a stored
   rubric hash and observing the shared gate fail with
   `[R001] rubric rubric.core hash drifted`.

   What the shared gate still does **not** prove is guard survivability. It
   checks that the corpus agrees with the oracle, not that every oracle rule
   has an isolating vector. The `Q010` and `X009` survivors above are measured
   only by `measureGuardSurvivability()`, which re-runs the whole corpus once
   per guard and is reachable only from the validator's own CLI entry point.
   Putting that in CI is a separate, slower job.
10. Two guards are disclosed survivors of the deletion campaign (§15.2). Both
    are evaluated on every run; only their deletion is invisible.
