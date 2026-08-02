# SQLite cursor Rule 11 outer-authority implementation log

Date: 2026-08-02 PDT

Scope: bounded Wave 1D implementation of the private cursor publication
`S -> P/context -> T -> E -> A -> W -> R11` predecessor graph in TypeScript and
Python. This log does not claim Rule 12, third-clock completion, production hook
activation, release readiness, or completion of the 21-day master plan.

## Coordination record

- The primary agent owned integration, affected regressions, append-only plan
  evidence, final diff review, commit identity, and push verification.
- A Python writer/auditor closed partial Rule 11 registration cleanup and hostile
  captured-intrinsic coverage, then froze source and test identities.
- A TypeScript/parity writer built the real-SQLite cross-runtime graph/report gate
  and repaired all independent-audit findings.
- An independent parity auditor first reported H0/M2/L1, then H0/M1/L0 after the
  initial repair, and finally H0/M0/L0 after the self-comparison claim was removed.
- The progress scanner remained active on its 30-minute systemd timer. The latest
  scan observed during integration was
  `codex_logs/scans/scan-20260802T201308.823980Z.json`: 108 total, 44 healthy,
  61 waiting-dependency, 3 stale, 0 blocked, 0 integration-risk, 13/78 required
  evidence entries satisfied. Scanner state is not used to overrule executable
  acceptance evidence.

## Implemented behavior

- Exact session authentication precedes cancellation, so a forged or drifted
  session cannot hide behind an already-cancelled signal.
- The composite leaf accepts only the session and optional cancellation. It owns
  the real outer-created prepared owner/context, consumed tombstone, connection
  execution, post-rebind adoption, write receipt, and Rule 11 receipt sequence.
- Cancellation before preparation preserves the authentic session; cancellation
  at the second boundary releases the prepared context/execution and permits a
  fresh retry with the same session.
- Context, tombstone, adoption, write, and Rule 11 registration faults discard
  partial tokens exactly. Post-consumption failures poison the selected outer
  graph while preserving the original primary exception.
- Rule 11 compares five safe exact counts: B2 population, native affected rows,
  `changes()` affected rows, total-changes delta, and cursor-ledger affected delta.
- The write receipt retains exact session/outer/context/tombstone/adoption state;
  the Rule 11 receipt retains the exact write receipt. Authenticated outer poison
  invalidates historical write and Rule 11 readers.
- Rule 11 evaluation and retained-proof reads perform no additional public SQLite
  work. The private protocol is not exported from package roots.
- Real SQLite N=0, N=1, and N=3 graphs pass through source capture, seal, receipt,
  TEMP B2 campaign, migration, publication session, rebind, adoption, and Rule 11.

## Review findings and resolution

The first independent parity audit found:

1. SQL hashes were only shape-checked. The comparator now recomputes SHA-256 from
   exact SQL text and compares it with fixed golden values.
2. Several identity/lifecycle claims were hardcoded. Reporters now derive session,
   prepared-owner, context, tombstone, adoption, authority, and lifecycle evidence
   from actual retained runtime objects.
3. Success cleanup swallowed rollback/dispose/close failures. Cleanup now aggregates
   failures, checks TEMP-stage/catalog/connection/root postconditions, and exits
   nonzero on cleanup failure.

The second audit found a remaining medium evidence issue: both reporters assigned
the retained write receipt from the Rule 11 snapshot and then compared that value
with the same property, making `sameIdentity.writeReceipt` tautologically true.
That field was removed from both portable projections and the strict comparator.
Exact W-to-R11 identity remains covered by focused runtime tests that hold an
independent W before minting/reading R11. The final delta audit was H0/M0/L0.

## Executed acceptance evidence

- TypeScript affected suite: 13 test files, 222/222 tests passed, 243.32 seconds.
- TypeScript focused candidate: 39/39 passed before the final test-description-only
  rename; the renamed targeted test then passed 1/1.
- Python outer-authority suite: 10/10 passed.
- Python subprotocol suite: 31/31 passed in 99.35 seconds.
- Python lower-source regressions: 20/20 passed by the independent audit.
- Cross-runtime parity: 3/3 passed, 0 failed, 0 skipped. The final real-SQLite
  deterministic/byte-exact case took approximately 54.208 seconds; total gate
  duration was approximately 54.335 seconds.
- Workspace TypeScript typecheck: all 9 participating workspace projects passed.
- Ruff: all four touched Python source/test files passed.
- mypy: both touched Python source files passed with no issues.
- Node syntax and Python AST checks for the final parity delta passed.
- `git diff --check` passed.
- All 15 implementation/test/parity files below had mode 0644 before staging.

## Frozen candidate identities

- `package.json`: `8741c6f296b0938e54631f0773367e65844c8fb55264b108941601a732224517`
- TS outer authority: `1415d1c2d7e1206c8e487ebae987ff29d4789966155dc8348231e4d249483111`
- TS rebind: `78ba9b772a3b08b7bc05dd183276aae82122253decde2dd71608fb0b022ad93b`
- TS clean graph: `bba13a05ddb729880cdb44dee087eb107963dd7e2487a05a0adfba1e3fe50dda`
- TS Rule 11 integration test: `b28e4e3f6f7234bac463efbd2bbfe6c857cd61d8f8d11f79be60881cc794229d`
- TS outer-authority test: `45a2e8652bd757f731dca8b7ec80b00d009613a2ca9f8a8d06ad58846563fee4`
- Python outer authority: `21bb6ad2bbdafadfd83cd67d5a1b33e3aa38fe0dc24a7ec7be7b5fba880683b2`
- Python subprotocol: `d762e61cb4bf028b24336cb71be0400aea1b0015716373ca220955f15741a00b`
- Python outer-authority test: `cebbc4e9be5f45e9983bcf10f54436e93d9b9ec6ca6f61ee1b0b52208844c694`
- Python subprotocol test: `75aac43ba062d36a880ec483b1bc5d0ce9ba7d9503d71993f686db9d11d5ebb2`
- TS parity graph: `1c7b5313207ef31b4474dd2c798cc3c713e370871b9a8821524a63a630132967`
- TS parity reporter: `12859d1afd962941a35a6efd0679bb4de628c667296ba42677be0648d36f0f66`
- Python parity graph: `e3ff93183c87fa6a7073b8aedbe64fa33b76e4f1441f915f169d238d6099d2ae`
- Python parity reporter: `b631730cba465595018a41b9341afaf87fa2e25805943be86415eddbec2d829d`
- Parity comparator: `20bc6844f4fdd74afc3b2cec6de91420a3b67c84a11245ac374d97b2561fee1d`

Fixed SQL commitments:

- Rebind SQL: `6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91`
- Changes SQL: `a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112`
- Parameter frame: `524ece2b423a16fe16cf147e4918f74029ec71bd1559a65a2e7e2710a73ef37f`

## Append-only plan proof

Before this integration append, the master plan had 20,297 lines. SHA-256 of
exactly those first 20,297 lines was and remains
`43632443a5dfbd8fc89c1cbb5d896cce3af277186206dbda06da2977391fb227`.
Sections 31.37.67 and 31.37.68 were appended; no prior plan content was changed.

## Residual nonclaims and next work

This increment does not yet directly exercise every hostile native seam required
by section 31.37.65.7. Remaining work includes controlled pre-consume release
failure, actual post-tombstone native statement-run failure, hostile native result
and `changes()` shape/type/range/close failures, complete B2/outer/cursor-ledger
drift matrices, and bounded real Python id-reuse evidence. The current Rule 11
mismatch path uses controlled private-state mutation and is not represented as a
real SQLite hook.

Rule 12, the third clock, cursor/clock completion, production/manifest activation,
full release/security/performance readiness, and the open-source adoption program
remain future waves. GitHub star counts are community outcomes, not acceptance
claims produced by these tests.
