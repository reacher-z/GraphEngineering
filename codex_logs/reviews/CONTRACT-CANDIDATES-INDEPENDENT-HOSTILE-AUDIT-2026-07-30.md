# Independent hostile audit of three uncommitted contract candidates — 2026-07-30

Reviewer: independent lane; did not author any reviewed artifact.
Base: branch `feat/authoring-foundation`, `HEAD=3fea613`, dirty working tree.
Scope: the uncommitted `D9-REDACTION-039`, `D10-BUDGET-SPEC-035` and
`D4-TRACE-SUBGRAPH-022` contract candidates.

## Verdict

| Contract | P0 | P1 |
|---|---|---|
| `D9-REDACTION-039` | 5 | 10 |
| `D10-BUDGET-SPEC-035` | 8 | 17 |
| `D4-TRACE-SUBGRAPH-022` | 16 | 22 |

**None of the three may be accepted as-is.** No file was modified by the review.

## The single most important finding

`D9-REDACTION-039` exists to eliminate a durable event history that writes raw
payloads while the wire flag asserts `redacted: true`. The candidate describes
that fix in prose and does not apply it.

`spec/event.schema.json` still declares

```json
"redacted": { "type": "boolean", "default": true },
"data": { "type": "object" }
```

so a v1alpha1 writer that omits `redacted` still has it default to `true` over
raw inline `data`. `spec/redaction-semantics.md` §3.1 MUST item 1 requires
removing that default; it is unapplied. §3.1 MUST item 4 requires updating the
shared fixtures to the same truth; `spec/conformance/run-created.event.json`
still asserts `"redacted": true`, and both native runtimes consume that fixture
as ground truth.

The release-blocking defect is therefore still live in the committed spec, and
no gate fails because of it.

## The second most important finding — the verification apparatus is inert

`scripts/validate-fixtures.mjs` enumerates its corpora explicitly through
imports and only `JSON.parse`s everything else. Neither `package.json` nor
`.github/workflows/ci.yml` references any of the three new validators.

- `D9` has no validator at all: `spec/conformance/redaction.validate.mjs` does
  not exist. Every obligation the semantics document delegates to "the shared
  semantic validator" — pointer ordering, count equality, MAC equality, AAD
  relations, policy/rule consistency — has no enforcer. The 21 executable
  `pointerCases` and 30 `wireCases` are never run.
- `D10` and `D4` have validators that pass on knowingly-wrong input.

`pnpm validate:fixtures` passes with all of this unverified.

## D9-REDACTION-039 — P0 items

1. `spec/event.schema.json` — the `redacted` default is unremoved and `data`
   stays open. The defect the task exists to fix is still live.
2. `spec/conformance/run-created.event.json` — the shared fixture still asserts
   `redacted: true`, propagating the false assertion into any implementation
   that matches it.
3. No `redaction.validate.mjs`; the corpus and all 13 schemas are unexecuted and
   unreferenced by any script, test or CI job.
4. `spec/redaction-receipt.schema.json` accepts all 54 sinks crossed with all 57
   source classes, so a document asserting `redacted: true` over authoritative
   `graph-input` written to the `event-journal` validates. This re-encodes the
   original lie one layer up. `event-v1alpha2` blocks it with
   `redacted: {const: false}`; the general disposition carrier does not.
5. `codex_plans/delivery/d9-redaction-implementation-brief.md` §14 makes
   acceptance depend on an RFC 6901 oracle, a semantic mutation oracle and
   inventory/Cartesian completeness checks that exist only as snippets pasted
   into a review log. Acceptance would be granted against machinery nobody can
   re-run.

Selected P1 items: only four of the five required truthful dispositions exist
(`omitted` and `artifact-ref` are missing, while `D4` lands
`spec/artifact-ref.schema.json` in the same tree); the master-plan §15.2
requirement that a new source or sink fail CI until it has a disposition has no
implementation; `spec/redaction-rule.schema.json` accepts `/__proto__`,
`/constructor` and `/prototype` pointers that §15.3 declares normatively
forbidden; `event-v1alpha2.schema.json` rejects the `inline-unredacted`
disposition that §4.3 requires implementers to emit; the "never double-transform
ciphertext" rule of §15.4 step 9 appears nowhere; §15.5 requires one seeded
canary per source and sink (57 + 54) while §12 narrows it to 7 seed points
without recording the narrowing; and the flow corpus covers 37 of 3,078
source-sink pairs (1.3%) with the evaluator existing only as prose. A review log
claims "the deterministic evaluator covers all 3,078 pairs"; no such evaluator
exists in the repository.

## D10-BUDGET-SPEC-035 — character of the failure

The validator is a real fold, not an echo check, but 5 of 30 mutations passed
with no golden edits at all, and 13 more were caught only by a frozen golden
hash rather than by any semantic rule — meaning a second-language runtime with
its own goldens would have no rule to fail.

Verified specifics: `budget.validate.mjs:497` overwrites
`pricing.policyBindingHash` with the computed policy hash before validating it,
so the shipped fixture's wrong value is never checked and
`GE_PRICING_POLICY_DRIFT` is unreachable on the positive path; line 501 repeats
the pattern for `routerPolicy.pricingSnapshotHash`; line 2121 iterates the
negative corpus with no count assertion, so deleting all 36 semantic negatives
prints "0 semantic negatives" and passes. Scope ceilings are never enforced, a
route-bound reservation need not cover its own route estimate (a 600,000×
under-reservation passed), and 7 of 12 hash domains the oracle uses are
undocumented, making independent cross-language reproduction impossible from the
specification.

## D4-TRACE-SUBGRAPH-022 — character of the failure

The validator is a single-instance golden pin rather than a rule engine: 16 of
30 mutations passed silently, and eight of its own guards have zero fixture
coverage, so deleting them still passes the shipped corpus.

Verified specifics in `subgraph-edge.validate.mjs`: line 943 exempts `publish`
from the terminal-state guard, so `StreamItemPublished` after `StreamCompleted`
is accepted in direct contradiction of the semantics document; lines 952-971
never read `state.sourceClosed`, so publication after `StreamSourceClosed` is
accepted; lines 946-951 bound per-grant credits only and never cumulative
demand, so 12 credits on a `maxItems=8` edge passed. Artifact authorization is
largely unevaluated — capability expiry, media type, size and lifetime mode are
never checked, and a 9 PB reference on a 4,096-byte edge passed. The artifact
digest check and the `previousEventHash` chain check can each be deleted without
failing the corpus. `scenario.completionOrder` is dead data, so the
determinism-under-concurrency claim is asserted by a message that can never
fire.

## Cross-cutting defects

1. No CI wiring for any of the three validators.
2. `spec/README.md` documents none of the three contract families, so
   `redaction-semantics.md` is discoverable from nowhere inside `spec/`. The
   documentation link checker passes because it only validates links that exist.
3. `codex_logs/task-registry.json` lists three files as `D9-REDACTION-039`
   expected artifacts and none of the 13 schemas or the corpus, so
   `check-release-map` and `check-evidence-closure` pass without ever seeing the
   machine contract.
4. `budget.case.json` and `subgraph-edge.case.json` carry no
   `contractStatus` / `implementationClaim: false` marker, unlike
   `redaction.case.json` and the SQLite corpora.

## What the audit confirms is sound

All 14 D9 `$id` values are unique repository-wide and follow the committed
`.../schemas/v1alpha2/<basename>` convention; every cross-schema `$ref` resolves
and all 14 schemas compile under strict Ajv. The corpus embeds only
`synthetic-sensitive-value` placeholders and no real secrets. The status headers
and `contractStatus: contract-only-native-implementation-required` are honest
and correctly disclose the implementation gap. `D10`'s status line is honest.
`D4`'s status header matches the established convention.

## Supplement — defects found while closing the D9 P0 items

Building the executable D9 validator surfaced four defects this audit did not
find. They are recorded here so the count above is not mistaken for the whole
picture. None is closed.

1. **The portable-key normalization-collision check cannot fire in JavaScript.**
   `redaction-semantics.md` §3.3.1 step 1 requires rejecting a candidate whose
   object keys collide after surrogate-pair normalization, and the corpus
   encodes `construct-surrogate-pair-key-collision` with UTF-16 code units
   `[55357, 56832]`. In JavaScript those code units *are* `U+1F600`, so
   `JSON.parse` deduplicates the keys before any validator observes them. The
   obligation is a structural no-op on this host and is testable only from
   Python, where no D9 oracle exists. The TypeScript validator implements the
   check for parity and must not be cited as enforcing it.
2. **Every `redactionRules` obligation passes vacuously.** Every capture-policy
   case in the corpus ships `redactionRules: []`, so §4.1's sink ordering,
   one-rule-per-sink, `registryVersion` equality and the bidirectional
   redacted-mode-implies-rule requirement are all satisfied by an empty set. The
   validator implements them; the corpus provides zero coverage.
3. **The flow corpus never exercises the redaction outcome.** The §3.2 truth
   table has four dispositions; `flowCases` covers only `protected-ref`,
   `metadata-only`, `suppressed` and `failed`. There is no `outcome: "redacted"`
   row anywhere, so the redaction path of the source-by-sink evaluator — the
   behavior the contract is named for — is uncovered by the only executable
   join that exists.
4. **`maxValueDepth` and `maxPointerTokens` are jointly unsatisfiable under the
   obvious depth convention.** A 128-token pointer addresses a value 128 levels
   below the root, so if the root counts as depth 1 the corpus's own
   `semantic-pointer-tokens-positive` case (128 tokens, expected valid)
   contradicts `maxValueDepth: 128`. The two limits are consistent only if the
   root is depth 0, and the specification never says which. The validator
   documents a root-is-depth-0 convention; the semantics document must state it
   normatively.

## Required disposition

None of the three contracts may be frozen or committed as accepted. The P0
items must be closed and every validator must become executable and CI-wired
before any native implementation lane is dispatched against these contracts.
Until then the corresponding registry tasks remain `in_progress` with the
blockers recorded, and no `implementationClaim` may move.
