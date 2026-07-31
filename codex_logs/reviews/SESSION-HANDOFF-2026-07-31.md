# Session handoff — 2026-07-30 into 2026-07-31

Base at session start: `3fea613`. This document is the honest state of the
work, written so the next session can resume without re-deriving anything.

## The one number that matters

**No registry task moved to `completed`.** The counts are unchanged:

| | start | end |
|---|---|---|
| completed | 41 | 41 |
| in_progress | 7 | 8 |
| planned | 59 | 59 |
| release checklist | 199 Open / 14 Green / 6 Partial | unchanged |

Fourteen commits landed and they closed real defects, but by this repository's
own evidence rules nothing reached acceptance. Anyone reading the commit list
should read this line first.

## What actually changed

### D9 redaction — the fix that was never applied

`D9-REDACTION-039` exists to eliminate a durable history that writes raw
payloads while the wire flag asserts `redacted: true`. The candidate described
that fix and did not apply it. `spec/event.schema.json` still declared
`"redacted": {"type": "boolean", "default": true}` beside an open `data`, and
`spec/conformance/run-created.event.json` — which both native runtimes consume
as ground truth — still asserted `redacted: true` over inline data. Both
corrected.

The verification apparatus was also inert. `scripts/validate-fixtures.mjs`
enumerates its corpora through explicit imports and merely `JSON.parse`s the
rest, and no script, test or CI job referenced any of the three new contract
validators. D9 had no validator at all, so fourteen schemas and a 1,422-line
corpus had never executed. `pnpm validate:fixtures` was green over all of it.
All three are now imported and run.

Five D9 P0s and four P1s closed. One audit finding was **withdrawn on
verification** — the claim that `maxValueDepth` and `maxPointerTokens` are
jointly unsatisfiable assumed the depth convention was unstated; §11 gives it
twice. It is recorded as withdrawn rather than deleted, because a withdrawn
finding is evidence the check ran.

### D6 barrier — tranche 1 complete and joined

Contract frozen, then corrected to revision 2 after **both implementation lanes
independently proved revision 1 was unimplementable**. Revision 1 made `GE1421`
own every portable barrier config, copying the router rule verbatim — but
`runtime-capability-semantics.md` names `{}` and exactly `{"condition": "all"}`
as the only supported barrier configs, and the capability gate refuses every
exact policy. Under revision 1 no barrier config would have both compiled and
executed. Ownership is now a versioned `apiVersion` claim.

Landed: the shared corpus (79 policy, 15 ownership, 16 compiler, 41 evaluation,
12 identity, 12 identifier, 8 replay; 60 independently recomputed literals),
TypeScript `6330204`, Python `a96f707`+`cddd203`, and the cross-language join
`0bc9307`.

The tranche adds **no capability**. It converts a wrong answer into a refusal:
a barrier still cannot evaluate a threshold, but it can no longer pretend it
did.

### Cycle conformance — a red CI gate, and a real divergence behind it

`node tools/conformance/run.mjs` was failing non-deterministically in CI. Root
cause was not flakiness but a genuine cross-language divergence. Attempt
timeout is the only bound in the cycle contract not driven by the injected
clock, and the two runtimes disagree about whether it can fire for a
synchronous handler: TypeScript's timer is a macrotask that can never preempt a
microtask-settling handler (0 timeouts in 20 iterations against `timeoutMs`
100), while Python's `asyncio.to_thread` dispatch genuinely races the wall clock
(p99 0.86 ms to a 661 ms maximum under load).

The durable consequence is the serious part: the planner binding is
`idempotent`, so a load-induced timeout writes an in-doubt activity. Two
conforming runtimes can produce different durable histories for identical
inputs purely because of machine load.

The campaigns now use coroutine handlers, which removes the observable flake.
**The divergence itself is not fixed** and is registered as
`D8-CYCLE-TIMEOUT-DIVERGENCE-090`. Resolving it is a specification decision with
a real trade-off, documented in `spec/cycle-semantics.md`.

### SQLite — the fourth initial-write receipt

`4526c24` closes operation-sequence-zero. It took four independent review passes
and each found what the previous could not: reading found four MEDIUMs; mutation
testing verified the fix and corrected the remediation's own claim that six
invariants were covered when only two were load-bearing; a direct probe found
the asserts never gated on authority lifecycle; blast-radius analysis found the
fix itself downgraded a retired authority from `STALE_FENCE` to `CORRUPTION`.

## A process failure worth carrying forward

Commit `a96f707` recorded a **stale blob**. The join lane was running a
divergence experiment that perturbs one line in `integrated_barrier.py`, and a
`git add python/` landed inside its perturbation window. The lane restored the
file and verified its hash, leaving the working tree correct and `HEAD` wrong.

Every gate passed. `pytest` ran before the perturbation, so 2,389 green said
nothing about the committed bytes. `mypy` and `ruff` were clean because a
typo'd string literal is well-typed and well-formed. `git diff --check` was
clean because nothing was malformed.

The cross-language join caught it on its first real run. Two lessons:

1. Do not stage a directory another lane is actively mutating.
2. "Working tree verified" is a strictly weaker claim than "commit verified",
   and no gate in this repository distinguishes them.

## What is open, ranked by risk

1. ~~**`D10-BUDGET-SPEC-035` (8 P0) and `D4-TRACE-SUBGRAPH-022` (16 P0).**~~
   **Both P0 sets are now closed** — D10 at `ffb7b16`, D4 at `d41b161`. Their
   P1s remain open and both still need a fresh independent review before either
   contract may be frozen. See "The two oracles" below.
2. **`D8-CYCLE-TIMEOUT-DIVERGENCE-090`.** Needs a normative decision.
3. **Three D9 P1s.** The surrogate-pair collision check cannot fire in
   JavaScript at all and is testable only from Python, where no D9 oracle
   exists; every `redactionRules` obligation passes vacuously because all corpus
   policies ship an empty rule set; and the flow corpus contains no `redacted`
   outcome row, so the evaluator path the contract is *named for* is uncovered.
4. **D6 tranche 2.** All barrier execution: arming, dispositions, satisfaction
   arithmetic, deadlines, the three non-pass resolutions, late arrival,
   cancellation propagation, decision documents, zero-rejudge replay.
5. **`D9-REDACTION-087/088/089`.** No runtime implements redaction.
6. **Everything from Day 10 to Day 21.** Budgets, verification, isolation,
   adapters, API freeze, production stores, workers, Explorer, performance, all
   ten pattern bundles, the fourteen-step course, Beta, compatibility matrix,
   RC, provenance, release. 59 tasks, none started.

## The two oracles

Both D10 and D4 were passing on knowingly-wrong input while wired into CI. That
is worse than having no oracle, because a green gate is read as evidence. Both
P0 sets are closed, and in both cases the remediation found more than the audit
had.

**D4 carries the number worth keeping.** A harness that neutralizes each
`D4Error` throw site in turn and requires the corpus to fail measured **37 of
110 rules held before, 133 of 144 after** — that is, 66% of the oracle was
deletable without the corpus noticing. Eleven survivors remain, enumerated in
`subgraph-and-edge-semantics.md` §15.1: five are unreachable without changing
the two frozen Graph IR documents and their published goldens, and six are
shadowed by a neighbour reporting the same portable code, so single-rule
deletion is invisible through a code-only portability check. All eleven are
implemented and exercised; only the deletion test is blind. That distinction is
recorded rather than smoothed over.

**D4 also exposed a general mechanism.** A mid-history mutation must reseal
every later `previousEventHash` and `eventHash`, or the integrity guard absorbs
it and masks the rule under test. That is precisely why the old
`previousEventHash` vector proved nothing — it was testing the integrity guard,
not the chain guard. A reseal mode now exists and the requirement is normative.

**D10 found eleven further zero-coverage guards the audit missed** — reservation
conservation, in-doubt and compensated bounds, account conservation, the four
deployment bounds, the provider-metric bound, and three binding rules. Negative
corpus 36 → 54.

**Both lanes declined to claim a number against the audit's own 30 mutations**,
because that list is not enumerated anywhere in the repository and could not be
re-run. Each built and reported its own measured campaign instead. That is the
correct answer to an unanswerable question and should stay the norm.

**Two normative decisions were made rather than deferred**, both disclosed. D10's
§5.3 "commit to ceiling and dispute the excess" was withdrawn because it is
structurally unrepresentable — §6.3 conservation and §6.1 subset invariants make
excess above the maximum neither committable nor disputable, so implementing the
prose would have broken the ledger's foundation. D4 mapped §9.2 step-2
validations to `PUBLICATION_FAILED` rather than `UNAUTHORIZED`, because the edge
refused the bytes and no reference exists.

## What cannot be done from inside this repository

Real npm and PyPI publication needs trusted-publisher credentials. External
usability evidence needs five or more real testers. Live provider evidence needs
API keys. macOS and Windows matrices need real machines. Star counts are an
observed outcome, never an artifact. These remain External and no amount of
local work closes them.

## The method that found everything

Every substantive defect this session came from making something recompute,
mutate, or independently reimplement — never from reading code.

- Review passes that read diffs found style issues. Mutation testing found that
  "six invariants covered" was two.
- Two implementation lanes found a contract defect that two review passes had
  missed entirely.
- The corpus lane refused an instruction from the integration lane, and was
  right: the instruction contradicted the frozen contract.
- The join caught a committed defect that both language suites called green.

The corollary is the thing to keep: a lane that never contradicts the
integration lane is a lane that is not checking. Three times today the
correction ran upward, and each time the contract or the instruction was what
changed.
