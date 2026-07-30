# SQLite Cursor B3 — operation-sequence-zero permanent publication receipt

Date: 2026-07-30
Leaf: master plan §31.37.35, the fourth and final ordered initial-write receipt
in the §31.37 initial-publication chain.
Base: branch `feat/authoring-foundation`; reviewed across `3fea613` to `e32fa8c`.
Status: **not committed.** Two inherited MEDIUM findings remain open.

## Review history

Two independent passes, neither by the author of the code.

**Pass 1** — verification and hostile review of the leaf as received:
**HIGH 0 / MEDIUM 4 / LOW 4**.

1. the leaf's defining invariant, provider-timestamp monotonicity, had zero
   test coverage, together with five other invariants collapsed into the same
   unreached branch;
2. those six unrelated invariants shared one error message, so a poisoned or
   out-of-phase authority was reported to the operator as a clock drift;
3. the assert compared the cached `outerProviderNowMs` to itself and never
   re-derived the timestamp from the authentic clock evidence, leaving the
   frozen `outer-provider-now-ms` commitment proven only by object identity;
4. no plan tranche and no review log accompanied the leaf, breaking the
   append-only authorization chain.

**Pass 2** — independent verification of the remediation, using real mutation
experiments on an isolated copy: **HIGH 0 / MEDIUM 2 / LOW 4**. All four
MEDIUMs and the specified LOW from pass 1 are genuinely closed; none was closed
cosmetically. Two new inherited MEDIUMs were found.

## Mutation evidence for the pass-1 closures

Each mutation was applied singly to a throwaway copy from a pristine backup, the
focused suite run, then the file restored and diff-verified.

| Mutation | Result | Reading |
|---|---|---|
| baseline | 25/25 pass | — |
| delete entry-state branch | 1 failed | branch is reached and load-bearing |
| delete monotonicity branch | 1 failed | the defining invariant is load-bearing |
| invert the boundary `<` to `<=` | 1 failed | `>=` is genuinely inclusive and tested at the boundary |
| revert the clock re-derivation to the cached field | 1 failed | the re-derivation, not the digest, rejects the receipt |
| delete the header-identity branch | 25/25 pass | that branch is dead — see LOW-4 below |
| move the SQL-identity `fail()` back inside the `try` | 25/25 pass | the hoist is unguarded — see LOW-1 below |

The clock re-derivation result answers the question pass 1 actually asked. The
test mocks the clock module to return `providerNowMs + 1` and then explicitly
re-asserts that `parameterSha256` and `resultSha256` are unchanged, so the
digests cannot be what rejected the receipt. Reverting only the re-derivation
fails only that test. `readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic`
reads `EvidenceState.providerNowMs` from a separate WeakMap, so the two sides of
the comparison are genuinely independent storage.

## Open findings

### MEDIUM-1 — the assert never gates on authority lifecycle

Proved by direct probe: publish sequence zero, poison the authority through an
unrelated route, then call the sequence assert and the snapshot reader. Both
return successfully. `authorityState()` does not reject poisoned or retired
authorities, and neither the sequence assert nor the header assert it delegates
to checks `lifecycle` or `writePhase`.

This is inherited by all four initial-write receipt leaves, but it becomes
materially dangerous at the very next one. Four-receipt atomic stage adoption
consumes exactly these receipts; if it validates them with these per-receipt
asserts, a graph poisoned any time after sequence zero completed still yields
four "valid" receipts and can be adopted onto a poisoned authority.

### MEDIUM-2 — the connection session that performs the write is untested

The ~190-line sequence-zero session in `sqlite-connection.ts` has no direct
coverage. None of its nine rejection messages appears anywhere in the sqlite
test tree. Every hostile case in the leaf mocks the module-level intrinsic
rather than driving the session, and the outer authority always hands it a valid
row.

The consequence was verified, not inferred: deleting the
`updatedAtMs < baselineCapturedAtMs` guard, or the
`totalChanges - state.totalChanges !== 1` check, or the `changes === 1n` check
leaves the full 1,006-test suite green. The second line of defence for the
leaf's defining invariant is unverified.

### LOW-1 — the SQL-identity hoist is unguarded

`translateSQLiteError` passes a `CycleStoreProviderError` through unchanged, so
the caller-visible message is identical whether the `fail()` sits inside or
outside the preflight `try`. Only the stage-ownership poison reason degrades,
and no test in the tree asserts a poison reason. The fix is correct and can
silently regress.

### LOW-2 — the monotonicity branch does not validate its own input

It validates `updatedAtMs` but never `baselineCapturedAtMs`. A NaN capture time
makes `updatedAtMs < NaN` false and the branch passes; the defect is then caught
only after the statement is prepared, converting a zero-progress pre-prepare
rejection into a `prepareCount = 1` rejection. Theoretical today because A2b
validates the envelope upstream.

### LOW-3 — `lint` is still byte-identical to `typecheck`

Every package's `lint` script is `tsc -p tsconfig.json --noEmit`. There is no
style or complexity rule in the workspace, so a passing lint gate is not
independent evidence of anything. This matters more here than elsewhere:
`cursor-publication-outer-authority.ts` is 4,150 lines and the sequence-zero
block is a near-verbatim fourth copy of the entries and header blocks. No tool
in the repository can detect the copy-paste divergence that invites; the only
defence is human review of a 639-line diff, which is exactly how the pass-1
MEDIUMs got through.

### LOW-4 — the pass-1 coverage claim is overstated

Of the six invariants pass 1 named, mutation proves only two are load-bearing:
`writePhase` and monotonicity. `lifecycle` is dominated, because
`poisonAuthorityGraph` and `retireAuthorityGraph` always set `writePhase`
alongside it. `activationCount` and `outerClockConsumedTombstone` are set
exactly once at activation and never change, so they cannot differ once
`writePhase` reaches `baseline-header-complete`. The header-identity branch is
entirely dead: `assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic`
already checks the same three fields immediately before it, and the top-of-
function graph gate forbids presenting a foreign header snapshot.

Recording this plainly: real new coverage is two of six, not six of six. The
remaining four conditions are defence in depth and prove intent, not behavior.

## Gates at review time

| Gate | Result |
|---|---|
| `pnpm --filter @graph-engineering/sqlite typecheck` | pass |
| `pnpm --filter @graph-engineering/sqlite test` | **30 files / 1,006 tests, 0 failed**, 335.80 s, zero timeouts |
| `pnpm -r typecheck` | 8/8 packages |
| `pnpm test:sqlite-ledger-contract` | 61/61; rebind-v2 `implementationClaim: false`, `activeManifestClaim: false`; ledger-replay `implementationClaim: false`, `protocolClaim: false` |
| `node scripts/validate-fixtures.mjs` | pass; 80 fixtures, 39 case manifests, 145 hostile obligations, 20 fault boundaries |
| `test/operation-baseline-cursor-stage-ownership.test.ts` isolated | 362/362, 295.26 s |
| `git diff --check` | clean |

An earlier full-suite run reported six `Test timed out in 15000ms` failures in
`operation-baseline-cursor-stage-ownership.test.ts`. That is a load artifact,
verified rather than assumed: the file passes 362/362 in isolation, the quiet-
machine full run had zero timeouts, and two loaded runs produced disjoint
failure sets.

## Independently recomputed frozen artifacts

- SQL text 154 bytes, byte-identical to plan §31.37.35.1 and to
  `spec/conformance/sqlite-cursor-publication-rebind-v2.case.json:391`.
- `sha256(utf8)` recomputed as
  `a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85`, matching
  the source constant, the plan and fixture line 392.
- Parameter order `["baselineId", "baselineCapturedAtMs", "updatedAtMs"]`;
  `last_commit_sequence` is a literal `0` in the SQL and can never be a
  parameter, matching `requiredLastCommitSequence: 0`.
- Ledger delta `+1/+1/+1`, re-derived in the assert as `after == before + 1` in
  all three dimensions with `before == headerSnapshot.outerLedgerAfter`,
  reaching the frozen counter profile
  `initial-sequence-complete-before-adoption` at
  `outerLedgerLogicalWriteSequence: 4`.
- Append-only plan prefix recomputed: `head -n 15109 | sha256sum` equals
  `fde874b690f0848553127750fee45f8fbcaa323b5f784d9711577a7ac008aff0`, matching
  §31.37.35's own claim.

## What this leaf does

It publishes the singleton `main.ge_cycle_operation_sequence` row from a frozen,
zero-caller-input `INSERT`. `baseline_id` and `baseline_captured_at_ms` come
from the retained A2b source envelope and the exact projection; `updated_at_ms`
comes from the retained provider clock evidence, and the leaf proves against a
real graph rather than a mock that `Date.now` is never called and that an
injected environment override is ignored. Provider-timestamp monotonicity is a
distinct branch with its own message and its own hostile case, inclusive at the
boundary, with each side killed independently by mutation. The receipt's frozen
`outer-provider-now-ms` commitment is proved against WeakMap-private clock
evidence rather than against the cached field it was minted from. The outer
ledger advances by exactly one in each of three dimensions. The leaf never
opens, commits or rolls back the caller transaction. The package root export
surface is unchanged and the negative-export test enumerates all nine new
runtime exports.

## What this leaf does not do

It consumes no receipt. It performs no four-receipt atomic stage adoption, opens
no publication session, does not rebind the cursor, implements neither
validation rule 11 nor 12, does not retire the TEMP stage, does not commit or
reopen the transaction, activates no manifest and adds no Python parity.
`implementationClaim` and `activeManifestClaim` remain `false` in every gate.

The frozen contract's failure-boundary vocabulary
(`operation-sequence-provider-timestamp-validation`, `GE_CURSOR_B3_INVARIANT`,
hostile obligations 98-99) is not wired to this runtime: the TypeScript path
emits free-text poison messages, and no test compares the runtime ledger to the
frozen counter profile. Four of the six entry-state and header-identity
conditions are unreachable by construction. The connection session that performs
the actual write is validated only transitively.

Protocol completion, adoption, release-candidate status and any external
adoption claim remain false.

## Disposition

Not authorized for commit. MEDIUM-1 and MEDIUM-2 must close first, and
MEDIUM-1 must close before the four-receipt adoption leaf begins, because that
leaf is what consumes these receipts.
