# D7-H03A activity interruption matrix evidence

Date: 2026-07-27
Candidate commit: `d501eae9f538244cd4e5f74fd90eb703ff5855d0`
Candidate tree: `5891f86fb1075f55282a1e1c62d5fd8dee47c106`
Parent: `951d6a6904d4b33b31cd7d9628a74dfb5f93407a`
Branch: `feat/authoring-foundation`
Producer: `/root`
Author and committer: `reacher-z <mtrxcop@gmail.com>`
Review mode: main-agent hostile self-review plus clean detached execution
Independent acceptance: **not obtained; still required**

## Decision

The candidate is accepted as an immutable D7-H03A implementation milestone.
It executes a closed 68-row activity-phase cancellation and attempt-timeout
campaign independently in TypeScript and Python, applies an independent
fixture oracle, and then compares the complete native reports exactly.

This decision does **not** complete master-plan H03, D7-TS-CYCLES-025,
D7-PY-CYCLES-026, or D7-CYCLE-CONFORMANCE-027. In particular, interruption
inside the public pause, resume, replay, and fork operations remains H03B work.
The accepted-patch interval between decision and durable visibility also needs
a dedicated behavioral campaign. No stable-release, production-durability,
full-plan, popularity, or star-count claim is made.

## Exact candidate identity and scope

The candidate contains 17 files, 2,106 insertions, and 47 deletions:

- TypeScript controller cancellation precedence, timeout accounting, exact
  post-handler cancellation checks, public interruption-matrix types and
  builder, exports, and native regressions;
- independent Python controller semantics, stable timeout code, interruption
  matrix and exports, and native regressions;
- one retained closed 68-row fixture with cardinality and canonical identity;
- independent TypeScript and Python executable campaign reporters;
- fixture validation that reconstructs the matrix without importing either
  runtime implementation;
- exact cross-language integration in the main conformance runner; and
- normative activity-interruption semantics plus corrected alpha-capability
  wording.

No D4, D9, D10, master-plan, task-registry, daily-log, progress-scanner
lockfile, or unrelated shared-worktree file is part of the candidate.

## Runtime defects closed

### TypeScript

The native TypeScript controller now:

1. gives caller cancellation precedence when a handler result and abort settle
   in the same microtask turn;
2. prevents a late result from crossing discovery, evaluation, mode, or patch
   outcome boundaries;
3. treats cancellation as a controller terminal fact rather than appending a
   false `ActivityFailed` event;
4. charges one already-durable open claim exactly once at the complete
   request-bound per-attempt ceiling;
5. keeps side-effect classification separate from charging, so `none` creates
   no in-doubt identity while external calls retain sound uncertainty;
6. records attempt timeout with `GE_CYCLE_ACTIVITY_TIMEOUT` and the complete
   per-attempt ceiling; and
7. checks cancellation again after successful finder, evaluator, mode, and
   patch-planner return before committing result-dependent state.

### Python

The native Python controller now:

1. checks cancellation and hard-stop state after a durable claim but before
   handler dispatch;
2. gives cancellation precedence over a same-turn handler completion and
   observes/discards the late task;
3. settles cancellation without inventing `ActivityFailed`;
4. records attempt timeout as `ActivityFailed` with stable code
   `GE_CYCLE_ACTIVITY_TIMEOUT`, exact charging, and shared retry handling;
5. enforces the declared per-round maximum when consuming a retryable failure;
6. checks cancellation after pending failure, discovery, evaluation, mode,
   and patch settlements before the next dispatch; and
7. no longer mistakes non-idempotent uncertainty created by the current live
   run for inherited uncertainty before that run can finish its durable
   settlement and terminal path. Resume and fork still reject inherited
   uncertainty at their public preflight boundary.

## Retained matrix identity

The retained fixture ID is
`cycle-controller-activity-interruption-v1alpha1`.

Its exact product is:

- five phases: finder, candidate evaluator, condition, optimizer evaluator,
  and patch planner;
- three side-effect classes: `none`, `idempotent`, and `non-idempotent`;
- eight trigger families;
- 53 caller-cancellation obligations;
- 15 attempt-timeout obligations; and
- **68 total unique obligations**.

The trigger expansion is:

| Trigger | Rows |
|---|---:|
| before first round | 1 |
| before activity claim | 5 |
| during handler | 15 |
| after handler, before outcome | 15 |
| after outcome, before next dispatch | 15 |
| attempt timeout | 15 |
| after round commit | 1 |
| repeated cancellation | 1 |

The canonical matrix is 11,890 UTF-8 bytes with SHA-256
`9d0d99e3bfd12d58fbc527f290cde432da3ec8e9d9f267aa725c041f14ae07a7`.
Fixture validation freezes the closed dimensions, timeout policy, sixteen
required assertions, all aggregate counts, canonical byte length, and hash.

## Independent per-row oracle

Every TypeScript row and every Python row performs a real native controller
run. Neither implementation delegates execution, serialization, or matrix
construction to the other language.

The campaign checks, independently of cross-language equality:

1. cancellation before the first round creates no round or activity claim;
2. pre-claim cancellation performs zero target-handler dispatch and zero
   target settlement;
3. a durable cancelled claim settles exactly once;
4. each cancelled claim consumes the request-bound USD 0.25 ceiling;
5. cancellation appends no `ActivityFailed` event;
6. a late handler result commits no target outcome;
7. timeout appends the stable code `GE_CYCLE_ACTIVITY_TIMEOUT`;
8. every timeout consumes one attempt and USD 0.25;
9. `none` and `idempotent` timeout twice under the retained two-attempt policy;
10. `non-idempotent` stops after the first ambiguous timeout;
11. `none` retains no in-doubt identity;
12. ambiguous external calls retain exactly one in-doubt identity;
13. committed discovery preserves its seen addition;
14. committed candidate evaluation preserves its accepted verdict;
15. an accepted patch preserves revision 2 and its one dynamic node;
16. cancellation before round commit cannot invent a dry round;
17. cancellation after round commit preserves one committed dry round;
18. repeated cancellation emits exactly one terminal event;
19. replay returns the exact terminal result without handler execution; and
20. terminal resume performs zero writes, handler dispatches, and clock calls.

The attempt-timeout handler never resolves, so the test cannot win through a
sleep-order race. The orchestration clock is fixed. The one-millisecond
per-attempt timer is a bounded trigger, not an assertion that a competing sleep
finishes first.

## Exact cross-language report join

For every one of the 68 rows, the TypeScript and Python reports compare:

- the complete matrix entry;
- canonical terminal-result bytes;
- the ordered event-type path;
- canonical bytes for every complete event;
- every event record hash;
- phase-projected activity and settlement paths;
- exact handler-call counts;
- repeated-cancellation count;
- failure event bodies;
- reservation-settlement bodies;
- in-doubt activity projections;
- canonical terminal checkpoint bytes; and
- terminal-resume zero-write, zero-dispatch, and zero-clock observations.

The report join is a full deep equality assertion. Aggregate count equality
cannot pass it. The additional independent fixture and semantic assertions
prevent a common TypeScript/Python defect from passing merely because both
runtimes agree.

During hostile self-review, that independent layer caught a real oracle
mistake: an accepted patch cancelled after `PatchAccepted` must preserve and
settle `dynamicNodes: 1`, not the generic activity value zero. The assertion
was narrowed to that committed-visibility case and the entire 68-row campaign
was rerun; it was not removed or weakened.

## Native unit regressions

Both runtimes expose and test their public 68-row builders, uniqueness,
phase/trigger counts, and first/last identities.

The TypeScript native tests additionally prove across all three side-effect
classes:

- timeout call counts of 2, 2, and 1;
- terminal attempt totals of 2, 2, and 1;
- terminal costs of USD 0.50, USD 0.50, and USD 0.25;
- exact timeout failure codes and per-event charges; and
- in-doubt counts of 0, 1, and 1.

The Python native tests prove the same vectors and replay observations. Both
also prove that cancellation racing a result charges one USD 0.25 claim,
commits no discovery, and creates no false failure event.

## Main shared-worktree verification

The following gates passed against the final implementation before the
immutable candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 185, CLI 147; **780 total** |
| Python tests | **1,088 passed plus 2 subtests** |
| Python Ruff and Mypy | passed; package source and the new reporter were checked |
| fixture validation | shared worktree 56 JSON fixtures and 21 case manifests; 855 structural plus 68 activity-interruption obligations passed |
| documentation links | shared worktree **252** links passed |
| cross-language conformance | 132 baseline events, 855 structural obligations, 100 lease recoveries, and **68 exact activity interruption recoveries** passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven manifests and dry-run tarballs passed; runtime contained 59 files |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both isolated installs passed |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | `git diff --check` passed |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work. They are reported transparently but are not used as
the immutable candidate totals.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h03a-verify.ppbsFM`

It was created at the exact 40-character candidate object ID with no branch.
Node and Python development dependencies were installed only from committed
locks and local caches:

1. `corepack pnpm install --frozen-lockfile --offline`;
2. `uv sync --project python --extra dev --offline --locked`.

The following cold gates passed against only committed bytes:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `python/.venv/bin/python -m pytest -q`;
4. `corepack pnpm lint`;
5. `corepack pnpm typecheck`;
6. `python/.venv/bin/ruff check python/src python/tests tools/conformance/python_cycle_report.py tools/conformance/python_cycle_interruption_report.py`;
7. `python/.venv/bin/mypy python/src tools/conformance/python_cycle_report.py tools/conformance/python_cycle_interruption_report.py`;
8. `corepack pnpm validate:fixtures`;
9. `corepack pnpm check:docs`;
10. `corepack pnpm check:release-map`;
11. `corepack pnpm check:evidence-closure`;
12. `corepack pnpm audit:prod`;
13. `corepack pnpm test:conformance`;
14. `corepack pnpm check:packages`;
15. `uv build --project python --offline`;
16. `python3 scripts/check-python-artifacts.py`; and
17. `corepack pnpm check:packed-install`.

The exact cold results were:

- all seven TypeScript builds, lint jobs, and type checks passed;
- all **780 TypeScript tests** passed;
- all **1,088 Python tests plus 2 subtests** passed;
- Ruff passed and Mypy found no issue in 36 checked source/report files;
- 53 committed JSON fixtures and 18 committed case manifests passed;
- all 68 activity-interruption and 855 structural obligations passed fixture
  validation;
- 231 committed documentation links passed;
- cross-language conformance passed for 132 exact baseline events, 24 activity
  inputs, 855 structural obligations, 100 lease recoveries, and **68 exact
  activity cancellation/timeout recoveries**;
- all three cycle modes, both in-doubt outcomes, terminal resolution, eight
  results, accepted patch/revision, crash/takeover, and eight checkpoints
  passed;
- release mapping passed for 178/178 leaves and all 40 tests;
- evidence closure passed in audit-only mode and all 102 subtests;
- all seven npm contents and isolated tarball installs passed;
- the runtime tarball contained 59 files;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- isolated wheel and sdist installs passed console-entry-point, shared YAML,
  `validate`, and `doctor` smoke tests; and
- the production dependency audit found no known vulnerability at the
  configured moderate threshold.

After all cold gates, `git status --short` was empty and the detached worktree
still resolved to commit `d501eae9f538244cd4e5f74fd90eb703ff5855d0`, tree
`5891f86fb1075f55282a1e1c62d5fd8dee47c106`.

## Review independence and agent availability

The implementation, hostile review, remediation, and evidence were performed
by `/root`. The three available subagents had exhausted their execution quota
until 2026-08-02 15:10, so no fresh independent reviewer could execute this
candidate during the milestone.

This is self-review plus executable hostile oracles, not independent
acceptance. A new reviewer must reproduce the 68-row product from the retained
fixture, challenge cancellation linearization and timeout policy, inspect the
complete canonical report join, and verify the immutable candidate before the
applicable D7 tasks can close.

## Commit hygiene

The candidate subject is `execute activity interruption fault campaign`.
Author and committer are exactly `reacher-z <mtrxcop@gmail.com>`. The commit
body is empty and contains no co-author trailer.

This evidence file is intentionally separate from the implementation commit,
so candidate code and tests remain immutable and directly reproducible.

## Explicit remaining H03 and D7 work

H03A covers activity-phase boundaries only. Material H03 work still includes:

- cancellation inside public pause, resume, replay, and fork operations;
- cancellation after patch acceptance decision but before durable visibility,
  separated from both proposal return and post-commit visibility;
- explicit caller-cancellation versus attempt-timeout versus absolute
  max-duration race and precedence vectors;
- interruption during terminal result delivery and administrative recovery;
- checkpoint-write failure combined with cancellation at each applicable
  activity outcome;
- provider/tool cancellation acknowledgement and non-cooperative synchronous
  handler stress;
- property-generated boundary schedules and long-running randomized races;
  and
- a fresh independent hostile review of the immutable candidate.

The 68-row H03A lattice is separate from the 855 event/stage/fault obligations.
H02 made 100 lease-administration rows fully behavioral; the other 755 event
rows remain structural obligations. Further D7 work still includes rejected
and malicious patches, corrupt and truncated checkpoints, fork lineage trees,
competing distributed leases, production event/checkpoint providers,
scheduler revision activation, performance limits, redacted observability,
migrations, and stable-release evidence.

Accordingly, the master plan and release roll-up remain active.
