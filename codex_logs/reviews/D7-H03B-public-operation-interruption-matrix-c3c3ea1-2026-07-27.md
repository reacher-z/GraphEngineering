# D7-H03B public-operation interruption matrix evidence

Date: 2026-07-27
Candidate commit: `c3c3ea152f50855435a7828d24cd6541d526be06`
Candidate tree: `c1612e24c1fc18bd0ad097e97f16c086bf5b6562`
Parent: `be4aadd4aaccab998f0b8630af9aa1219711c538`
Branch: `feat/authoring-foundation`
Producer: `/root`
Author and committer: `reacher-z <mtrxcop@gmail.com>`
Review mode: main-agent hostile self-review plus clean detached execution
Independent acceptance: **not obtained; still required**

## Decision

The candidate is accepted as an immutable D7-H03B implementation milestone.
It adds operation-level cancellation and deterministic fault observation to
the public pause, resume, replay, and fork controller operations, executes a
closed 25-row native campaign independently in TypeScript and Python, checks
each result against an executable oracle, and deep-compares both complete
reports.

This decision does **not** complete master-plan H03, D7-TS-CYCLES-025,
D7-PY-CYCLES-026, D7-CYCLE-CONFORMANCE-027, or the 21-day plan. H03A and H03B
together establish strong cancellation behavior at activity and public
operation boundaries, but they do not make all 855 structural fault rows
behavioral and do not prove production-store durability, arbitrary in-flight
I/O preemption, provider cancellation acknowledgement, or distributed
in-doubt reconciliation. No stable-release, full-plan, popularity, or
star-count claim is made.

## Exact candidate scope

The implementation commit contains 18 files, 1,925 insertions, and 25
deletions. Its subject is `execute public operation interruption campaign`.

The exact committed paths are:

- `packages/runtime/README.md`;
- `packages/runtime/src/cycle-controller.ts`;
- `packages/runtime/src/cycle-faults.ts`;
- `packages/runtime/src/cycle-types.ts`;
- `packages/runtime/src/index.ts`;
- `packages/runtime/test/cycle-controller.test.ts`;
- `python/README.md`;
- `python/src/graph_engineering/__init__.py`;
- `python/src/graph_engineering/cycle_contract.py`;
- `python/src/graph_engineering/cycle_controller.py`;
- `python/src/graph_engineering/cycle_faults.py`;
- `python/tests/test_cycle_controller.py`;
- `scripts/validate-fixtures.mjs`;
- `spec/cycle-semantics.md`;
- `spec/conformance/cycle-controller-operation-interruption.case.json`;
- `tools/conformance/cycle_operation_interruption.mjs`;
- `tools/conformance/python_cycle_operation_interruption_report.py`; and
- `tools/conformance/run.mjs`.

No D4, D9, D10, master-plan, task-registry, daily-log, progress-scanner
lockfile, or unrelated shared-worktree file is part of the candidate.

## Retained operation matrix

The retained fixture ID is
`cycle-controller-operation-interruption-v1alpha1`.

It freezes the following complete public-operation product:

| Operation | Observed boundaries | Rows |
|---|---|---:|
| pause | before read, after read, after fold, before commit, after lease release, before return | 6 |
| resume | before read, after read, after fold, before commit, after lease acquisition, before return | 6 |
| replay | before read, after read, after fold, before return | 4 |
| fork | before/after parent read, after parent fold, before/after child read, before child commit, after child creation, after child lease, before return | 9 |
| **Total** | **all retained public-operation boundaries** | **25** |

The closed expected outcomes are:

| Outcome | Rows |
|---|---:|
| stable operation cancellation | 18 |
| durable controller cancellation | 3 |
| committed result wins | 4 |

The durability partition is:

| Durability class | Rows |
|---|---:|
| read-only | 4 |
| operation not committed | 14 |
| operation committed | 7 |

The canonical matrix is exactly 4,288 UTF-8 bytes with SHA-256
`100c5dccee5f199291813ea723bf0b3996783ad5126820d42e42f58385e32cfd`.
The retained fixture file itself has SHA-256
`20133792d5b50335eeda4b4fd578b46cd80332af1c56b891592404059d308bce`.
Fixture validation reconstructs the matrix independently of either runtime,
then freezes operation counts, outcome counts, durability counts, canonical
length, canonical hash, boundary membership, uniqueness, and fourteen
required semantic assertions.

## Public API closure

### TypeScript

The public TypeScript controller now accepts operation cancellation for all
four administrative operations:

1. pause accepts a cancellation signal and operation fault hook;
2. resume retains its signal and fault hook while observing the new complete
   boundary set;
3. replay accepts an options object containing a signal and fault hook while
   remaining read-only; and
4. fork retains its signal and fault hook while observing parent, child, and
   post-commit boundaries.

The operation fault surface and matrix builder are exported through the
runtime public entry point. Existing callers that omit options retain their
prior behavior.

### Python

The Python controller exposes the same behavior with native Python types:

1. pause accepts `CycleCancellation` and an operation fault hook;
2. resume uses the same cancellation object through recovery and live work;
3. replay accepts cancellation and a fault hook without acquiring a lease or
   appending an event; and
4. fork observes cancellation across parent read, child read, child creation,
   child lease, and return boundaries.

The cancellation error, hook vocabulary, matrix builder, and public option
types are exported from the package root. Python does not shell out to, import,
or delegate execution to the TypeScript implementation.

## Linearization rules proved by the campaign

The implementation treats cancellation as an observation at a named edge,
not as an instruction to rewrite already committed history.

### Before an operation commit

At every applicable pre-commit boundary:

- the operation throws or raises the stable operation error;
- the code is exactly `GE_CYCLE_OPERATION_CANCELLED`;
- the structured details are exactly `{operation, boundary}`;
- no operation event is appended;
- no checkpoint is written;
- no activity handler is dispatched; and
- the original stream remains byte-for-byte unchanged.

This applies to four pause boundaries, four resume boundaries, and six fork
boundaries. Replay is read-only at all four of its boundaries and therefore
also appends zero events and writes zero checkpoints.

### After a controller-producing commit

Some administrative operations create a controller fact before they can
return. Cancellation observed after that point cannot honestly report that
nothing happened.

- Resume cancellation after lease acquisition converges the controller to one
  durable `CANCELLED` terminal result and dispatches no activity handler.
- A dispatchable fork cancelled after child creation acquires the required
  child lease and durably converges the child to `CANCELLED`; it does not leave
  an apparently runnable orphan.
- Fork cancellation after child lease acquisition also converges to one
  durable terminal result without handler dispatch.
- Repeated observation does not create duplicate terminal events.

These three paths are classified as `controller-cancelled`, not as
`operation-cancelled`, because a durable controller identity already exists.

### After the operation's durable effect

Once the operation's defining fact is durable, the committed fact wins:

- pause after lease release returns the paused checkpoint;
- pause cancellation at its final before-return boundary still returns the
  committed pause result;
- resume cancellation at its final before-return boundary returns the
  committed terminal result; and
- fork cancellation at its final before-return boundary returns the committed
  child result.

Late cancellation cannot turn a successful durable operation into a false
failure. This rule accounts for the four `committed-result` rows.

## Recovery-debt exception

A pre-cancelled resume normally performs no write. One material exception is
required for safety: a controller that already contains an open durable round
or activity claim carries recovery debt from a prior process.

For that case, resume must:

1. acquire a replacement lease under the existing authority rules;
2. settle or release the inherited durable debt exactly once;
3. preserve any sound in-doubt projection;
4. append one durable `CANCELLED` terminal fact;
5. dispatch no new activity handler; and
6. return the exact terminal result on later replay/resume.

Treating the caller's pre-cancelled signal as permission to abandon inherited
claims would strand durable work. The implementation therefore retains and
tests this narrow safety exception rather than weakening the existing H03A
recovery invariant.

## Executable per-row oracle

Every one of the 25 TypeScript rows and every one of the 25 Python rows runs a
real native controller operation. The campaign verifies more than aggregate
counts.

For each row it checks:

1. the exact matrix identity and boundary;
2. the boundary is observed exactly once;
3. the expected outcome class;
4. stable error code and exact structured details where applicable;
5. pre-operation and post-operation event counts;
6. canonical bytes for every appended event;
7. complete stream canonical bytes;
8. every event record hash;
9. exact checkpoint projection, including absence;
10. exact operation result projection, including absence;
11. terminal result and controller status projections;
12. handler dispatch counts;
13. clock and lease effects relevant to the path;
14. parent-stream immutability during fork;
15. child-stream creation and convergence where applicable; and
16. zero writes for all replay rows.

The final TypeScript and Python reports are compared with a full deep-equality
assertion. Both native reports are approximately 391 KiB. Cross-language
equality alone is not the oracle: the independent fixture reconstruction and
per-row semantic assertions prevent the same defect in both implementations
from passing merely because their bytes agree.

## Native regression coverage

The TypeScript runtime suite now contains 186 tests. The Python controller
suite contains 53 tests. Both runtimes directly test:

- matrix cardinality and unique identities;
- the 6/6/4/9 operation distribution;
- the 18/3/4 outcome partition and 4/14/7 durability partition;
- canonical matrix byte length and SHA-256;
- exact stable operation-cancellation details;
- zero-write replay cancellation;
- pre-commit stream immutability;
- pause commit-wins behavior;
- resume lease-to-terminal convergence;
- fork child creation and lease-to-terminal convergence;
- terminal replay/resume idempotence;
- no post-observation handler dispatch; and
- inherited recovery-debt settlement under pre-cancellation.

The main fixture validator independently reconstructs the expected boundary
product rather than importing either runtime's matrix builder.

## Main shared-worktree verification

The following gates passed against the completed implementation before the
immutable candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 186, CLI 147; **781 total** |
| Python tests | **1,089 passed** |
| Python Ruff and Mypy | passed across 35 package/report source files |
| fixture validation | shared worktree 57 JSON fixtures and 22 case manifests; all retained obligations passed, including 25 operation rows |
| documentation links | shared worktree **253** links passed |
| cross-language conformance | 132 baseline events, 855 structural fault obligations, 100 lease recoveries, 68 activity recoveries, and **25 exact public-operation recoveries** passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven manifests and dry-run tarballs passed |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both isolated installs passed |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | `git diff --check` passed |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work. They are reported transparently but are not used as
the immutable candidate totals.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h03b-verify.AUriv9`

It was created at the exact 40-character candidate object ID with no branch.
Node and Python development dependencies were installed from committed locks:

1. `corepack pnpm install --frozen-lockfile`;
2. `uv sync --project python --extra dev --frozen`.

The final cold gate order was:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `corepack pnpm lint`;
4. `corepack pnpm typecheck`;
5. `python/.venv/bin/python -m pytest -q`;
6. Ruff over package source, tests, and conformance reporters;
7. Mypy over package source and conformance reporters;
8. fixture validation;
9. documentation-link validation;
10. release-task-map validation and its hostile tests;
11. evidence-closure audit and its hostile tests;
12. the complete cross-language conformance runner;
13. npm package-content validation;
14. isolated installation and smoke testing of all seven npm tarballs;
15. `uv build --project python`;
16. Python wheel/sdist audit and isolated installation smoke tests;
17. production dependency audit; and
18. `git diff --check`, clean-status, exact commit, and exact tree checks.

### Gate-order observations

The first cold orchestration attempt invoked the recursive workspace test
before building dependency packages. A clean checkout correctly lacked
`packages/core/dist`, and the MCP package compile stopped at that missing
build prerequisite. The same test suite had passed in the shared tree because
build outputs already existed there. This first invocation is recorded as a
procedural gate-order failure and is **not** counted as a passing run.

The cold suite was then rerun in the repository's actual release order,
`build -> test -> lint -> typecheck`, and exited zero. No source or committed
file was changed to obtain that result.

Likewise, an artifact-audit invocation made before `uv build` correctly
rejected an empty wheel/sdist set. The CI-documented order,
`uv build -> check-python-artifacts.py`, then built, audited, installed, and
smoke-tested both artifacts successfully. This pre-build rejection is not
counted as a passing artifact audit.

### Exact cold results

- all seven TypeScript builds, lint jobs, and type checks passed;
- all **781 TypeScript tests** passed;
- all **1,089 Python tests** passed;
- Ruff passed and Mypy found no issue in 35 checked package/report files;
- 54 committed JSON fixtures and 19 committed case manifests passed;
- all 855 structural, 68 activity-interruption, and 25 public-operation
  interruption obligations passed their applicable fixture checks;
- 232 committed documentation links passed;
- release mapping passed for 178/178 leaves and all 40 validator tests;
- evidence closure passed in audit-only mode and all 102 hostile subtests;
- cross-language conformance passed for 14 graph fixtures, 24 RFC formatter
  vectors, 13 portable values, 15 public-boundary rejections, 10,000 seeded
  finite bit patterns, runtime scheduling, invalid output/cancellation,
  barriers, routes, persistence, recovery, terminal interop, and pipelines;
- native-cycle conformance passed for 132 exact baseline events, 24 activity
  inputs, 855 durable fault obligations across 171 boundaries, 100 executable
  lease-renew/release recoveries, 68 exact activity recoveries, and **25 exact
  pause/resume/replay/fork interruption recoveries**;
- all three cycle modes, two in-doubt outcomes, the authority-bound terminal
  resolution, eight terminal results, accepted patch/revision, crash/takeover,
  and eight baseline checkpoints passed;
- authoring conformance passed its two equivalence cases, six valid-source
  cases, 21 builder diagnostics, 77 source failures, 13 typed diagnostics, and
  ten identity mutations;
- all seven npm package manifests and dry-run tarballs passed;
- all seven npm tarballs installed in isolation, workspace dependencies were
  rewritten correctly, and installed bins passed smoke tests;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- isolated wheel and sdist installs passed console entry points, shared YAML,
  `validate`, and `doctor` smoke tests; and
- the production dependency audit found no known vulnerability at the
  configured moderate threshold.

After all cold gates, `git status --short` was empty, `git diff --check` passed,
and the detached worktree still resolved to commit
`c3c3ea152f50855435a7828d24cd6541d526be06`, tree
`c1612e24c1fc18bd0ad097e97f16c086bf5b6562`.

## Review independence and agent availability

The implementation, hostile review, remediation, and evidence were performed
by `/root`. The three available subagents had exhausted their execution quota
until 2026-08-02 15:10, so no fresh independent reviewer could execute this
candidate during the milestone.

This is self-review plus executable hostile oracles, not independent
acceptance. A fresh reviewer must independently reconstruct the 25-row
product, challenge every linearization point, test the recovery-debt exception,
inspect both complete canonical reports, and reproduce the immutable candidate
before the applicable D7 tasks can close.

## Commit hygiene

The candidate author and committer are exactly
`reacher-z <mtrxcop@gmail.com>`. Its body is empty and contains no co-author
trailer. The evidence file is intentionally separate from the implementation
commit, so the code and tests remain immutable and directly reproducible.

All unrelated shared-worktree modifications and untracked D4/D9/D10 contract
artifacts were excluded from the candidate and must remain excluded from the
evidence commit.

## Explicit remaining H03 and D7 work

H03B closes the retained public-operation boundary product. Material work
still includes:

- cancellation after patch acceptance decision but before durable visibility,
  separated from proposal return and post-commit visibility;
- explicit caller-cancellation versus attempt-timeout versus absolute
  max-duration race and precedence vectors;
- interruption during terminal-result delivery and administrative recovery;
- checkpoint-write failure combined with cancellation at each applicable
  activity and public-operation outcome;
- provider/tool cancellation acknowledgement and non-cooperative synchronous
  handler stress;
- property-generated boundary schedules and long-running randomized races;
- production event/checkpoint providers and crash injection against them;
- multi-process competing leases and real network partitions;
- in-doubt reconciliation backed by external provider identities;
- malicious and rejected patch campaigns;
- corrupt and truncated checkpoint recovery;
- fork-lineage trees and scheduler revision activation;
- performance, bounded-memory, redacted observability, and migration evidence;
  and
- a fresh independent hostile review of both H03A and H03B.

The 25-row H03B lattice and 68-row H03A lattice are separate from the 855
event/stage/fault obligations. H02 made 100 lease-administration rows fully
behavioral; the remaining structural rows must not be represented as executed
fault recoveries until dedicated campaigns exist.

Accordingly, the master plan and release roll-up remain active.
