# SQLite P11-A NP1 evidence and release-control binding audit — 2026-08-03

## Audit question and disposition

This audit defines how an independently accepted, immutable NP1 runtime tranche
may be recorded without claiming that P11, D9, or any release gate is complete.
It does not accept the current working tree, replace the runtime review, or
authorize a commit. Runtime acceptance still requires the complete NP1 gate and
an independent final `H0 / M0 / L0` disposition.

The correct control boundary is the existing task
`D9-SQLITE-OWNER-COMPOSITION-P11-094`. NP1 is bounded progress inside that task,
not a new task, completed dependency, release leaf, or release candidate. The
task must remain `in_progress` after NP1 acceptance because global P11-A route
closure and red gates, P11-B, P11-C, P11-D, stage 18, third-clock consumption,
COMMIT, and D9 remain open.

## Canonical precedent

Prior accepted P11 tranches use two commits:

1. an immutable implementation/contract commit; then
2. a separate `chore(evidence)` commit that updates only bounded progress
   evidence, the task heartbeat/artifact inventory, the next action, and the
   review log's immutable commit binding.

The evidence commit never changes P11 to `completed` and never gives a bounded
tranche release weight. NP1 must follow the same sequence. A working-tree hash
or live log cannot substitute for the immutable implementation commit.

## Exact task-registry reconciliation after acceptance

Only after the runtime commit is immutable, pushed, ref-verified, and accepted
by the independent whole-diff review should `codex_logs/task-registry.json` be
reconciled as follows:

- preserve task ID, title, owner, `status: in_progress`, work package,
  dependencies, risk, `evidence_required`, assignment/start timestamps, and
  `blocker: null`;
- advance root `updated_at` and the P11 task's `last_heartbeat` to the same real
  UTC reconciliation instant;
- do not add `completed_at` or `completion_evidence`;
- do not add a passing `test_evidence` entry. The current expected-test strings
  describe complete P11 slices or the final portable/hostile/full-SQLite
  acceptance, while NP1 closes only a strict subset of P11-A. Recording one of
  those broad requirements as passed would overclaim;
- preserve the current five `expected_tests` strings unchanged;
- append the accepted NP1 artifact inventory to `expected_artifacts`, without
  deleting or rewriting any earlier P11 artifact:
  - `spec/conformance/sqlite-cursor-publication-native-projection-np1.schema.json`
  - `spec/conformance/sqlite-cursor-publication-native-projection-np1.validate.mjs`
  - `spec/conformance/sqlite-cursor-publication-native-projection-np1.test.mjs`
  - `packages/sqlite/src/cursor-publication-native-projection-bridge.ts`
  - `packages/sqlite/src/cursor-publication-transaction-owner.ts`
  - `packages/sqlite/src/operation-baseline.ts`
  - `packages/sqlite/src/operation-baseline-source.ts`
  - `packages/runtime/src/cycle-contract.ts`
  - `packages/runtime/src/cycle-store-provider.ts`
  - `packages/runtime/src/json.ts`
  - `packages/sqlite/test/cursor-publication-native-projection.test.ts`
  - `packages/sqlite/test/cursor-publication-native-projection-gc.test.ts`
  - `packages/sqlite/test/cursor-publication-native-projection-parity.test.ts`
  - `packages/sqlite/test/cursor-publication-native-projection-report-cli.test.ts`
  - `packages/sqlite/test/probes/cursor-publication-native-projection-gc.probe.test.ts`
  - `packages/sqlite/test/sqlite_cursor_publication_native_projection_report.mjs`
  - `packages/sqlite/test/support/cursor-publication-native-projection-normalized-report.ts`
  - `packages/sqlite/test/support/cursor-publication-native-projection-report-runner.ts`
  - `python/src/graph_engineering/sqlite_cursor_publication_native_projection_bridge.py`
  - `python/src/graph_engineering/sqlite_cursor_publication_transaction_owner.py`
  - `python/src/graph_engineering/sqlite_operation_baseline_source.py`
  - `python/tests/sqlite_cursor_publication_native_projection_report.py`
  - `python/tests/test_sqlite_cursor_publication_native_projection.py`
  - `codex_logs/reviews/SQLITE-P11-A-NP1-RUNTIME-IMPLEMENTATION-2026-08-03.md`
  - `codex_logs/reviews/SQLITE-P11-A-NP1-EVIDENCE-BINDING-AUDIT-2026-08-03.md`
- update `next_action` to the remaining P11-A global route-unknown closure and
  red-matrix work required by master-plan section 31.37.98.6. It must explicitly
  retain the P11-B/C/D, stage 18, third-clock, COMMIT, D9, release, and popularity
  nonclaims.

Four modified NP1 files are intentionally not repeated in that append list
because the current P11 task already contains their exact paths in
`expected_artifacts`: the P11 Markdown spec, its executable validator, and the
TypeScript and Python owner-composition modules. Reconciliation preserves those
existing entries and appends only paths not already present.

`package.json` and `.github/workflows/ci.yml` are mandatory NP1 gate wiring and
must be reviewed and committed with the runtime tranche. They are shared root
control surfaces rather than task-owned protocol/runtime artifacts, so this
audit does not require adding them to P11's future completion-artifact contract.
The final reviewer may require that stricter binding if the candidate-evidence
policy changes before P11 completion.

## Release-map and candidate-evidence disposition

No edit is permitted to the canonical release checklist or
`codex_plans/delivery/release-task-map.json` for NP1. The P11 task has no direct
mapping among the 178 canonical release leaves. The dependency graph documents
it as supporting evidence that may feed future D9 extended-durability evidence
only after all downstream joins close.

No candidate may be appended to
`codex_logs/release-evidence/task-revalidation.json`. NP1 cannot cover the 93
required release-rollup ancestors, and there is no completed P11 task contract
to bind. The overlay therefore remains audit-only with zero candidates and
`0/93` release weight.

## Control-gate baseline

The following checks were run against the current live control files before any
NP1 registry reconciliation:

- `corepack pnpm check:task-controls`: passed; registry `112` tasks / `44`
  completed, graph `299` dependency edges / `72` semantic edges, and `12/12`
  task-registry tests.
- `corepack pnpm check:release-map`: passed; `178/178` exact release leaves,
  `175` blocking / `3` non-blocking, `37` blocking producers in a `94`-task
  roll-up closure, and `40/40` tests.
- `corepack pnpm check:evidence-closure`: passed; audit-only mode, zero
  candidates, zero selected tasks, `0/93` release weight, and `102/102` tests.

These passes prove that the current controls remain internally consistent. They
do not prove NP1 runtime correctness and do not authorize changing P11 or
release status. After the conditional registry/log reconciliation, all three
checks must be rerun and remain identical in status and release weight.

## Immutable binding still required

The final implementation log must replace its live-working-tree disclaimer only
after the runtime commit exists. It must record the exact full commit SHA,
author and committer identity, absence of a co-author trailer, local/tracking/
remote ref equality, exact accepted test commands and results, append-only plan
prefix proof, independent final severity count, and all nonclaims above. The
later evidence commit must then record its own immutable SHA without presenting
that second SHA as runtime evidence.
