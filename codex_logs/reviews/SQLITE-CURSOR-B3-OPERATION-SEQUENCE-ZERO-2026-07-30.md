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

## Third pass — both MEDIUMs remediated

**MEDIUM-1** is closed at the shared boundary. A new module-local
`liveAuthorityState()` refuses a terminal authority — poisoned yields
`GE_CYCLE_STORE_CORRUPTION`, retired yields `GE_CYCLE_STORE_STALE_FENCE` — and
all four initial-write asserts now route through it, so the three snapshot
readers inherit the gate through their asserts. `authorityState()` itself is
deliberately left ungated, because the authority snapshot reader and the
poison and retire paths must keep reading terminal state; dozens of existing
tests assert `lifecycle: "poisoned"` through exactly that path.

A fourth pass corrected the justification recorded here for a second deliberate
ungating. This log originally said `assertSQLiteCursorPostDdlCatalogFenceIntrinsic`
is safe because it is "reached transitively through the gated reader proof".
That is factually wrong. Four callers reach it, and three of them —
`readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic`,
`mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic` and
`executeSQLiteCursorPostDdlPublicationReaderIntrinsic` — pass no gated assert
first. The decision is still safe, but for a different reason: the fence
assert's own first act is `assertSQLiteCursorOuterPublicationAuthorityIntrinsic`,
which requires `lifecycle === "active"`. Recording the wrong reason is its own
defect, because a future edit removing that inner assert would silently open all
three paths while the reasoning here still read as sound.

The same pass established why the original defect hit exactly three surfaces and
no more, which this log had not explained. `assertSQLiteCursorOuterPublication
AuthorityIntrinsic` already refuses a non-active authority and sits on the path
of every pre-receipt operation. The header assert delegates to
`assertBaselineEntriesHeaderPredecessorIntrinsic`, the one predecessor helper
that reaches neither the active assert nor the fence assert — so the reader
terminal proof and the entries assert were already closed, and only the header
assert, the sequence assert and the sequence snapshot reader were exposed. The
gate closes the real gap and does not paper over a wider one.

One ordering consequence was handled rather than absorbed. In the sequence-zero
executor the authority's own entry-state check now runs before the delegated
header proof, because otherwise the new gate would have converted the existing
`"publication entry state drifted"` rejection into `"authority is poisoned"`,
silently changing which failure an operator sees.

The closure is proved by mutation, not by inspection. Reverting all four call
sites to `authorityState` reproduced the original defect exactly: on a poisoned
authority the header assert, the sequence assert and the sequence snapshot
reader each returned successfully. With the gate restored all five refuse.

**MEDIUM-2** is closed by a new direct session test file exercising the
connection-level sequence-zero session for real rather than through a mocked
intrinsic. Each of the three previously unverified guards was independently
proved load-bearing by removal:

| Guard removed | Observed |
|---|---|
| `updatedAtMs < baselineCapturedAtMs` | the SQL `CHECK` fires instead, so the code changes from `GE_CYCLE_STORE_INVALID_ARGUMENT` to `GE_CYCLE_STORE_CORRUPTION` — the guard was catching it before the physical write |
| `totalChanges - state.totalChanges !== 1` | the write is accepted |
| `changes === 1n` | the affected-row message no longer fires |

The earlier LOW about the unguarded SQL-identity hoist is also closed: the
stage-ownership poison reason is now exposed on the authority snapshot and
asserted, and re-applying the reviewer's mutation E is now caught.

Two of the nine session rejection messages remain unreachable by driving the
session — `"owner drifted during prepare"` requires the owner transaction,
epoch or `total_changes` to move across a single `prepare`, which executes
nothing, and `"result is invalid"` requires the native `run` to return a
non-object. Both intrinsics are captured at module load, so no test seam reaches
them without faking the native layer. They carry labelled source comments rather
than tests, which is the honest disposition.

The `baselineCapturedAtMs` bound added for LOW-2 is dominated and unreachable,
and the remediation says so rather than claiming coverage: a hostile capture
time cannot survive the baseline-header write, and mutating the retained
envelope afterwards is caught by the header receipt proof, since NaN can never
satisfy the snapshot equality. Removing the new bound leaves the suite green.
The added test pins what LOW-2 actually cares about — a hostile retained capture
time is rejected with zero prepares, no row, and no session begin.

Suite after remediation: **32 files / 1,022 tests, zero failures, zero
timeouts**, up from 30 / 1,006. Ledger contract 61/61 with both claim flags
still false. The frozen SQL, its SHA-256, the parameter order and the ledger
arithmetic are untouched, `src/index.ts` is unmodified, and no new package-root
export was introduced.

## Fourth pass — independent blast-radius review of the shared gate

Verdict **HIGH 0 / MEDIUM 1 / LOW 3**, safe to commit with the MEDIUM tracked.

The gate is correct. All thirteen remaining `authorityState()` callers were
enumerated and judged individually; none is a hole the gate was meant to close.
The retired-versus-poisoned lifecycle is monotonic and provably single-writer:
`lifecycle` is assigned in exactly three places, both terminal writers
early-return on an already-terminal graph, retirement never sets a poison
reason, and the `active` assignment cannot resurrect a terminal graph. The
`writePhase` halves of the gate are genuinely dominated by the `lifecycle`
halves, exactly as the source comment claims.

The gate is also not over-strict, which was the other half of the risk. No
production or test flow asserts a receipt after retirement; the disposal helper
only rolls back and closes. The module has no production consumer at all — no
file under any `packages/*/src/` imports it — so today's blast radius is
confined to its own tests. Earlier leaves re-run in isolation: 4 files / 104
tests passed.

One improvement was found rather than a regression: on a terminal authority the
reader terminal proof and the entries assert used to surface
`GE_CYCLE_STORE_INVALID_ARGUMENT "…is not active"` leaked from the nested fence
assert, and now surface the correct `CORRUPTION` / `STALE_FENCE` pair. No
committed test asserted the old code.

Both honesty claims from the third pass survived independent verification. The
two unreachable session messages are genuinely unreachable — `hardenSQLiteNative
StatementIntrinsic` executes no SQL and the private transaction fields have no
caller-controlled writer, and `statementRunIntrinsic` is a module-private const
captured at load, outside the `vi.spyOn` seam the suite uses. The dominated
`baselineCapturedAtMs` bound has three independent dominators.

### The MEDIUM: a retired authority is misclassified as corrupt

`executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic` checks
`writePhase !== "baseline-header-complete"` ahead of the gated header proof. The
reviewer proved the reachable `writePhase` set at that point is exactly
`{poisoned, retired}`, because reaching it requires having passed the receipt
identity check and the reuse gate. It is therefore not a phase-machine check at
all — it is a second, unlabelled terminal check shadowing the labelled one.

For a poisoned authority this is message-only. For a **retired** one the code
class changes from `GE_CYCLE_STORE_STALE_FENCE` to `GE_CYCLE_STORE_CORRUPTION`,
against the module's own new doc-comment. A caller that loses its
`BEGIN EXCLUSIVE` generation — ordinary concurrency, retryable one layer up — is
told the store is corrupt instead of stale-fenced.

No existing test would have caught it: the only entry-state test drives a
poisoned graph, where the two orderings are indistinguishable, and no test
drives a retired authority through any executor at all. The sibling
baseline-header executor still checks its phase *after* its delegated proof, so
the two now use opposite precedence.

This matters specifically because the next leaf is four-receipt atomic
adoption, and it is the first code that must act on the difference between
"this generation is gone, retry" and "this store is corrupt, stop".

### The MEDIUM and both actionable LOWs are closed

The reviewer's first option was taken: the sequence-zero executor now resolves
`liveAuthorityState` at entry and the shadowing entry-state branch is deleted,
since it had no non-terminal trigger. Its phase clause was not discarded — it
was folded into the adjacent dominated defence-in-depth branch and moved after
the delegated header proof, which is what makes the two sibling executors match.
Precedence is now identical in both: entry graph shape, reuse gate, delegated
predecessor proof, own phase and state check, local identity checks, with
terminal classification hoisted to a single `liveAuthorityState` call at entry.
The baseline-header executor was aligned the same way.

The fix is proved load-bearing by mutation in both directions. Reverting the
sequence-zero executor reproduces the reported regression verbatim — a retired
authority reported as `GE_CYCLE_STORE_CORRUPTION` rather than
`GE_CYCLE_STORE_STALE_FENCE`. Reverting the header executor produces a different
and previously unnoticed defect: that executor was already code-correct, but it
surfaced a predecessor-specific message,
`"SQLite baseline-header publication transaction lineage is stale"`, rather than
the shared terminal vocabulary. So the two new tests pin different properties —
the sequence-zero test pins the code class, the header test pins the shared
message — and both fail on revert.

`LOW-2` is closed: the migration-0002 receipt reader now routes through
`liveAuthorityState`, so a terminal authority yields the same
`CORRUPTION` / `STALE_FENCE` pair as the four receipt proofs instead of a
divergent `INVALID_ARGUMENT "…is not active"`. `LOW-3` is closed by comment: the
post-DDL fence assert now names its own internal active-authority assert as the
lifecycle boundary for the three callers that reach it with no gated assert on
the path, so the reasoning cannot rot silently.

`LOW-4` remains open and needs no code change: the reader-lease snapshot reader
performs no authority check at all, but it self-labels
`mayMintStageAdoptionReceipt: false` and `consumesAnyWriteReceipt: false`. The
adoption leaf's design must reference those labels so the distinction is not
rediscovered by accident.

Suite after the fix: **32 files / 1,024 tests**, up from 1,022 by exactly the two
new retired-authority executor tests. Ledger contract 61/61 with both claim flags
still false. One test expectation was deliberately changed and is recorded here:
the existing entry-state test drives a genuinely poisoned graph, so it now
expects the labelled poisoned message from `liveAuthorityState` rather than the
deleted branch's message; its code, counter and no-write assertions are
unchanged.

## Disposition

Accepted for commit at HIGH 0 / MEDIUM 0 / LOW 1, the remaining LOW being
documentation for the successor leaf. MEDIUM-1 from the second pass — the
lifecycle gate — is now closed, which was the gating item for four-receipt
atomic adoption, since that leaf is the first code that must distinguish
"this generation is gone, retry" from "this store is corrupt, stop".
