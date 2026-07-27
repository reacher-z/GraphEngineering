# D7-H02 event-derived durable fault matrix evidence

Date: 2026-07-27
Candidate commit: `da380deafb6f5722e318aea8507292328590b5e2`
Candidate tree: `efa4870e1897ca09ff57fca9e9a5313430b7c5b3`
Parent: `5bdc57245d75d7b8cc7e1da04064cf902613f338`
Branch: `feat/authoring-foundation`
Producer: `/root`
Author and committer: `reacher-z <mtrxcop@gmail.com>`
Review mode: main-agent hostile self-review plus clean detached execution
Independent acceptance: **not obtained; still required**

## Decision

The candidate is accepted as an immutable D7-H02 implementation milestone for
an event-vocabulary-derived durable-boundary and fault-kind matrix. It is not
an acceptance of the complete D7 workstream, does not close the release
roll-up, and does not support a production-durability claim.

The implementation replaces an informal list of crash points with one closed,
public, executable lattice shared by TypeScript and Python. The lattice is
derived from all 17 schema-authorized controller event types, ten event and
checkpoint stages that apply to every event, one terminal delivery stage that
applies only to `ControllerTerminated`, and five fault kinds. It therefore
contains 171 unique durable boundaries and 855 event/stage/fault obligations.

This milestone additionally fixes a native Python recovery drift discovered
while exercising the matrix: an unmatched safe or idempotent durable
`ActivityStarted` claim is now reused exactly on resume. Python no longer
fabricates a second attempt or a second activity key where TypeScript reuses
the committed claim.

## Exact candidate identity and scope

The candidate contains 19 files, 1,362 insertions, and 48 deletions:

- TypeScript public fault vocabulary, boundary constructor, matrix builder,
  hook runner, controller/store/checkpoint/terminal hook placement, exports,
  tests, and runtime documentation;
- Python public fault vocabulary, matrix builder, controller/store/checkpoint/
  terminal hook placement, resume correction, exports, tests, and package
  documentation;
- one shared conformance fixture binding the schema event enum, stage
  templates, fault kinds, durability classes, matrix counts, canonical byte
  count, and digest;
- fixture validation that reconstructs and validates the complete matrix;
- cross-language reporting and exact differential comparison; and
- normative durable-boundary text in the cycle semantics.

The three newly added implementation/contract files are:

- `packages/runtime/src/cycle-faults.ts`;
- `python/src/graph_engineering/cycle_faults.py`; and
- `spec/conformance/cycle-controller-fault-matrix.case.json`.

No D4, D9, D10, master-plan, task-registry, daily-log, progress-scanner lockfile,
or unrelated shared-worktree changes are part of the candidate.

## Closed event vocabulary

The executable matrix is bound to these 17 schema-authorized event types:

1. `ControllerCreated`;
2. `LeaseAcquired`;
3. `LeaseRenewed`;
4. `LeaseReleased`;
5. `RoundReserved`;
6. `ActivityStarted`;
7. `ActivityFailed`;
8. `InDoubtActivityResolved`;
9. `DiscoveryCommitted`;
10. `CandidateEvaluationCommitted`;
11. `ModeOutcomeCommitted`;
12. `BudgetReservationSettled`;
13. `BudgetReservationReleased`;
14. `PatchAccepted`;
15. `PatchRejected`;
16. `RoundCommitted`; and
17. `ControllerTerminated`.

Fixture validation reads the enum directly from
`spec/cycle-controller-event.schema.json` and requires exact ordered equality
with the matrix manifest. A newly added event cannot silently escape the fault
contract: schema/matrix drift fails fixture validation and cross-language
conformance.

## Canonical durable stages and boundaries

Ten stages apply to every event, and the terminal stage applies only to the
terminal event:

| Stage | Boundary template | Required durable observation |
|---|---|---|
| `before-event-construction` | `event:{eventType}:before-construction` | event not committed |
| `after-event-construction` | `event:{eventType}:after-construction` | event not committed |
| `after-prospective-fold` | `event:{eventType}:after-fold-before-cas` | event not committed |
| `before-store-commit` | `store:event:{eventType}:before-commit` | event not committed |
| `after-store-commit` | `store:event:{eventType}:after-commit-before-return` | event committed |
| `after-store-return` | `event:{eventType}:after-store-before-state` | event committed |
| `after-state-update` | `event:{eventType}:after-state-before-dispatch` | event committed |
| `before-checkpoint-construction` | `checkpoint:{eventType}:before-construction` | event committed |
| `after-checkpoint-construction` | `checkpoint:{eventType}:after-construction-before-save` | event committed |
| `after-checkpoint-save` | `checkpoint:{eventType}:after-save-before-ack` | event and checkpoint committed |
| `terminal-result-delivery` | `terminal:ControllerTerminated:during-delivery` | terminal event committed |

Both public boundary constructors reject unknown event types and unknown
stages. They do not coerce, truncate, substitute, or silently map hostile
inputs. The canonical hooks coexist with the legacy
`event:{type}:before-cas` and `event:{type}:after-cas` injection points so this
milestone does not silently break existing fault-injection callers.

## Closed fault-kind vocabulary

Every durable boundary is crossed with each of these five declared kinds:

1. `process-loss`;
2. `store-error`;
3. `timeout`;
4. `cancellation`; and
5. `commit-then-throw`.

The hook intentionally does not translate an injected exception. The caller's
fault injector controls the concrete failure carrier while the matrix controls
the exact durable boundary and expected durability class. This keeps the
orchestration deterministic without pretending that five operating-system or
distributed-store failure mechanisms are all the same exception type.

## Matrix identity and cardinality proof

The canonical ordered matrix has these immutable properties:

- 17 event types;
- 11 declared stages;
- five fault kinds;
- 171 unique event/stage boundaries;
- 855 complete event/stage/fault obligations;
- 163,770 canonical UTF-8 bytes; and
- SHA-256
  `235a81ff9342d91541d092f2306600feece980fb2c6eec1f2cc098273cbc3a23`.

The expected durability distribution is:

| Durability class | Obligations |
|---|---:|
| `event-not-committed` | 340 |
| `event-committed` | 425 |
| `event-and-checkpoint-committed` | 85 |
| `terminal-event-committed` | 5 |
| **Total** | **855** |

TypeScript and Python independently build the matrix. Conformance compares the
whole ordered carrier, not only these aggregate counts, then compares the
canonical bytes and digest. A reordered row, changed boundary spelling,
changed durability class, omitted fault kind, or language-only entry fails.

## Runtime placement and recovery behavior

Canonical hooks are placed around actual controller operations rather than in
an isolated matrix-only helper:

- before and after event construction;
- after prospective fold and before compare-and-swap append;
- immediately before the memory-store commit;
- immediately after commit but before store return;
- after store return but before controller state replacement;
- after controller state replacement and before downstream dispatch;
- before checkpoint construction;
- after checkpoint construction and before save;
- after checkpoint save and before acknowledgement; and
- during terminal result delivery after terminal durability exists.

The same event path is used by ordinary execution and authority-bound
in-doubt resolution. TypeScript exposes the hook on controller run and
resolution options and on the memory event store. Python exposes the
equivalent controller option and event-specific before/after-commit store
hooks.

The tests inject failures across seven representative event phases, all three
checkpoint phases, and terminal delivery. They verify the durable history,
checkpoint presence, resume behavior, and absence of duplicate semantic
output. A failure after commit is not mislabeled as an uncommitted event, and a
failure before commit cannot manufacture durable history.

While applying those oracles, native Python revealed a recovery discrepancy.
The corrected path now:

- identifies the unmatched durable `ActivityStarted` claim;
- reuses its original attempt number;
- reuses its stable activity key;
- does not append a fabricated replacement start claim; and
- agrees with the TypeScript native report and shared durable semantics.

## Main shared-worktree verification

The following gates passed against the implementation before the immutable
candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build and lint | all seven public workspace packages passed |
| TypeScript tests | core 166, primitives 147, persistence 27, runtime 179, patterns 93, MCP server 15, CLI 147; 774 total |
| Python tests | 1,066 passed |
| Python Ruff | passed |
| Python Mypy | 34 source files, no issues |
| fixture validation | 55 JSON fixtures, 20 case manifests in the shared worktree; complete 855-obligation matrix passed |
| documentation links | 250 local links in the shared worktree passed |
| cross-language conformance | 132 exact cycle events, 24 activity inputs, and all 855 obligations over 171 boundaries passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | seven public package manifests/tarballs passed; runtime contained 59 files |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both installed and passed entry-point/shared-YAML/validate/doctor smoke |
| production dependency audit | no known vulnerabilities at moderate threshold |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work. They are reported for transparency but are not used
as immutable candidate counts.

One initial documentation invocation used the nonexistent script spelling
`docs:check-links`. The repository reported the missing command, the canonical
`check:docs` command was then used, and it passed. This was a command-selection
error, not a candidate failure, and is retained rather than hidden.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h02-verify.qhWJPF`

The worktree was created at the exact 40-character candidate object ID. It had
no branch and no tracked changes before verification. Dependencies were
installed from the lockfiles and local cache with:

1. `corepack pnpm install --frozen-lockfile --offline`;
2. `uv sync --project python --extra dev --offline`.

The following commands then passed in the detached worktree:

1. `corepack pnpm build`;
2. `corepack pnpm lint`;
3. `corepack pnpm test`;
4. `uv run --project python pytest -q python/tests`;
5. `uv run --project python ruff check python/src python/tests tools/conformance/python_cycle_report.py`;
6. `uv run --project python mypy python/src`;
7. `node scripts/validate-fixtures.mjs`;
8. `corepack pnpm check:docs`;
9. `corepack pnpm audit:prod`;
10. `corepack pnpm test:conformance`;
11. `corepack pnpm check:release-map`;
12. `corepack pnpm check:evidence-closure`;
13. `corepack pnpm check:packages`;
14. `corepack pnpm check:packed-install`;
15. `uv build --project python --offline`;
16. `python3 scripts/check-python-artifacts.py`.

The exact cold results were:

- all seven TypeScript package builds and type checks passed;
- all 774 TypeScript tests passed;
- all 1,066 Python tests passed;
- Ruff passed and Mypy found no issue in 34 source files;
- 52 committed JSON fixtures and 17 committed case manifests passed;
- 229 committed documentation links passed;
- cross-language conformance passed for 132 exact cycle events, 24 activity
  inputs, 855 fault obligations over 171 boundaries, all three controller
  modes, two in-doubt recovery outcomes, one terminal resolution, eight
  terminal results, one accepted patch/revision, one crash/takeover resume,
  and eight checkpoints;
- release mapping passed for 178/178 leaves and all 40 tests;
- evidence closure passed in audit-only mode and all 102 subtests;
- seven npm tarball contents passed, including a 59-file runtime package;
- seven locally rewritten npm tarballs installed and their bins passed;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- isolated wheel and sdist installs passed console-entry-point, shared YAML,
  `validate`, and `doctor` smoke tests; and
- the production dependency audit found no known vulnerability at the
  configured moderate threshold.

The first cold `check:python-package` invocation ran before a wheel or sdist
existed and correctly failed its artifact precondition. The canonical CI order
builds artifacts first. Running `uv build --project python --offline` followed
by the exact checker passed completely. The failed precondition is retained as
execution evidence and is not classified as a candidate defect.

After all checks, `git status --short --branch` still showed only detached HEAD
and no tracked changes. The candidate tree remained exactly
`efa4870e1897ca09ff57fca9e9a5313430b7c5b3`.

## Review independence and agent availability

The implementation and remediation were performed by `/root`. The three
available subagents had exhausted their execution quota until 2026-08-02
15:10, so no fresh independent reviewer could execute this candidate during
the milestone. This log therefore records self-review plus executable hostile
oracles only and explicitly does not claim independent acceptance.

An independent reviewer must still inspect the immutable candidate, reproduce
the matrix from the event schema, challenge hook placement, and confirm that
the durability labels match the actual commit intervals before the applicable
D7 task can be closed.

## Commit hygiene

The candidate subject is `add event-derived durable fault matrix`. Author and
committer are exactly `reacher-z <mtrxcop@gmail.com>`. The commit message has no
co-author trailer.

This evidence file is intentionally separate from the implementation commit so
the candidate tree, tests, and review boundary remain immutable and auditable.

## Explicit remaining D7 work

This milestone does not close D7. The following work remains material:

- independent hostile review of this exact immutable candidate;
- full behavioral restart or recovery oracles for every one of the 855 matrix
  rows, beyond structural parity and representative injected execution;
- every-exit-reason and one-below/at/above hard-stop differential matrices;
- rejected, malformed, stale, conflicting, and malicious GraphPatch histories;
- checkpoint corruption, truncation, stale acceleration, and replay proofs;
- fork lineage trees, missing or cyclic ancestry, parent uncertainty, and
  competing lease/fencing races;
- production event and checkpoint stores with real transaction boundaries;
- distributed lease backends and takeover tests under real contention;
- scheduler revision integration and patch activation barriers;
- property/model tests and long-running randomized crash campaigns;
- performance and memory benchmarks at large history and matrix sizes;
- operator observability, safe redaction, migrations, compatibility policy,
  and production deployment guidance; and
- the still-open master-plan tasks outside the D7 cycle subsystem.

Accordingly, all release-level and full-plan completion claims remain open.
