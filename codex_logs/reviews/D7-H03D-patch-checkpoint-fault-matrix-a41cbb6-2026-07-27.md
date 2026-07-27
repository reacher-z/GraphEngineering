# D7 H03D PatchAccepted checkpoint fault-campaign evidence

Date: 2026-07-27

Milestone: H03D, PatchAccepted checkpoint-construction/save fault campaign

Disposition: accepted as an immutable, bounded implementation milestone

Candidate commit: `a41cbb64a4b745525c15753838fe17b756dd4bb7`

Candidate tree: `eb3a500a9a0976bb3cb5b87c9b751357025200e2`

Candidate parent: `029c55acf018163ec65942c537f829f593d3e821`

Branch: `feat/authoring-foundation`

Producer and self-reviewer: `/root`

Independent reviewer: unavailable; all three delegated-agent execution quotas
were exhausted until 2026-08-02 15:10.

## Decision

The exact candidate above is accepted as the H03D implementation candidate.
It closes the retained checkpoint-specific portion of the `PatchAccepted`
fault campaign: three checkpoint boundaries crossed with all five durable fault
kinds, for 15 executable obligations in each native runtime.

The campaign proves the distinction between the authoritative event stream and
its derived checkpoint acceleration artifact. All 15 rows begin after the
`PatchAccepted` event has committed. A fault before checkpoint save may leave
the prior valid checkpoint one event behind; a fault after checkpoint save may
leave a checkpoint exactly at the accepted patch. Both prefixes recover the
same revision-2 state from events, perform no second patch-planner call, settle
the patch budget once, commit the round once, terminate once, and finish with
an exact terminal-prefix checkpoint.

The candidate also closes a real public-surface parity gap. TypeScript already
supported an explicit portable event-count checkpoint interval. Python now
offers the equivalent optional `checkpoint_every_events` parameter on start,
resume, and fork, with fail-closed safe-integer validation and compatible
omitted-option behavior.

This decision does **not** close D7, the full H03 program, the 21-day master
plan, a stable release, or the broader Graph Engineering goal. It does not
claim production filesystem, database, replicated-log, object-store, or
multi-process crash durability. It is deterministic in-memory fault evidence
for one closed 15-row contract.

## Immutable candidate provenance

The implementation was committed only after the shared-worktree campaign,
native unit suites, static checks, fixture reconstruction, full cross-language
conformance, release mapping, artifact installation, and dependency audit had
passed. The exact object was then checked out into a detached clean worktree
and the complete cold verification was repeated from committed lock state.

Git identifies the candidate as:

```text
commit a41cbb64a4b745525c15753838fe17b756dd4bb7
tree   eb3a500a9a0976bb3cb5b87c9b751357025200e2
parent 029c55acf018163ec65942c537f829f593d3e821
author reacher-z <mtrxcop@gmail.com>
committer reacher-z <mtrxcop@gmail.com>
subject execute patch checkpoint fault campaign
body   empty
```

The implementation commit contains 16 files, 682 insertions, and 27 deletions.
It carries no `Co-authored-by` trailer and no additional commit-message body.

## Exact committed scope

| Path | Candidate SHA-256 | Role |
|---|---|---|
| `CHANGELOG.md` | `ac06ee5378c8b77d5cd8aedcf026c2f5bbed80ef22280ca57eadee92c7cf1a88` | public change record |
| `packages/runtime/README.md` | `a7b2cd836bd9320403f245f37477d2b760c563ea99d3e18d48f54e0c72f810e4` | TypeScript checkpoint-campaign documentation |
| `packages/runtime/test/cycle-controller.test.ts` | `e07ff6d25434cfa4ac962ac694ab7a9d6b0d6754b2d20e123c462d319dd6794b` | TypeScript matrix-closure test |
| `python/README.md` | `bb854e58719f39f5e5de519a1c3f9535106b074c4f6d2629e5a25f0fb619d140` | Python interval and campaign documentation |
| `python/src/graph_engineering/cycle_controller.py` | `9706b9a196432098837546405e90d25943ac9b6defb47d92f83a28cc537762c2` | portable Python checkpoint scheduling and validation |
| `python/src/graph_engineering/cycle_fold.py` | `2f1724df45ccc7e65f0150b53e37811c62a851831e7a7674ce09389ec3ab8231` | Python 3.14/Mypy hygiene without behavior change |
| `python/tests/test_cycle_controller.py` | `818f18ace3dee00d7c8c7afe496a154433a4da1ce01a71f941fedeece1aecccc` | Python matrix, interval, and rejection tests |
| `scripts/validate-fixtures.mjs` | `2ec1a1375501f4fc62636a59a2a37174aeaef6fb3abb6b4338f10245cd6574e5` | independent H03D fixture reconstruction |
| `spec/conformance/cycle-controller-patch-checkpoint-fault.case.json` | `8deaaae8a62fc7d0a2f12483f0dc0e74fcf613e9af5c86d2bc17810d25948e96` | retained checkpoint-fault contract |
| `spec/cycle-semantics.md` | `91e9f9a7330e3c90b0711ab042c9b0bc694720287bd1b92d1ddb05b5acfe68da` | normative authority and recovery semantics |
| `tools/conformance/cycle_patch_checkpoint_fault.mjs` | `e24abd7f3d42ae5a75e2c42a0cb7ff71a49106d8a6aff47375c7613eee263f55` | TypeScript H03D campaign entry point |
| `tools/conformance/cycle_patch_visibility_fault.mjs` | `c2a7c710532f7514972097723a2d88dc5a5898860ef50a0152b0871d4965b0d9` | generalized native TypeScript patch runner |
| `tools/conformance/python_cycle_operation_interruption_report.py` | `18bf6ccef3c30f4915f9479ad35cbd94b9542d8da7f2a85415ab3ea8a9b363e6` | static-analysis-only redundant-cast cleanup |
| `tools/conformance/python_cycle_patch_checkpoint_fault_report.py` | `e3ef5fa02883d36805680519acfe88094fa411933a423026431c72ebdd5bc5a0` | Python H03D report entry point |
| `tools/conformance/python_cycle_patch_visibility_fault_report.py` | `a57bc12075ded52cf48c2b216175f32ed4063ecef5696877da44d08d323c89a9` | generalized native Python patch runner |
| `tools/conformance/run.mjs` | `bba62396179f2ff83330390635aa3c247dee67bae374dab7a6055d387b0411da` | complete native-report deep-equality gate |

The retained JSON fixture itself has SHA-256
`8deaaae8a62fc7d0a2f12483f0dc0e74fcf613e9af5c86d2bc17810d25948e96`.
That file digest is distinct from the canonical ordered matrix digest below.

## Why a runtime change was required

H03C could inject event-visibility faults in both native runtimes without
changing runtime behavior. H03D could not be executed symmetrically because
TypeScript had the explicit `checkpointEveryEvents` schedule used by the
portable controller contract, while Python only wrote its named round and
terminal convenience checkpoints.

Without an explicit event-count schedule, the Python controller could not
reach these exact boundaries immediately after `PatchAccepted`:

1. before checkpoint construction;
2. after checkpoint construction but before save; and
3. after checkpoint save.

The candidate adds the smallest compatible public primitive needed to expose
those boundaries. It does not replace the legacy convenience behavior.

The public Python option is available on:

- `start_cycle(..., checkpoint_every_events=...)`;
- `resume_cycle(..., checkpoint_every_events=...)`; and
- `fork_cycle(..., checkpoint_every_events=...)`.

The accepted domain is an actual Python integer from zero through
`9_007_199_254_740_991`, inclusive. Validation explicitly rejects:

- booleans, despite `bool` being an `int` subclass in Python;
- negative integers; and
- integers beyond the cross-language safe-integer ceiling.

Invalid values fail with `INVALID_REQUEST` before any event append or
checkpoint write. This prevents partial streams created by bad scheduling
configuration.

## Backward compatibility and portable scheduling

The option has three deliberately distinct states:

| Supplied value | Python behavior | Portable interpretation |
|---|---|---|
| omitted / `None` | existing named round and terminal convenience checkpoints | preserves previous Python API behavior |
| `0` | latest checkpoint only at controller termination | explicit portable zero interval |
| positive safe integer `N` | latest checkpoint when event count is divisible by `N`, plus termination | explicit portable event-count schedule |

For an explicit interval, the checkpoint ID is
`{controllerRunId}-latest`. The checkpoint timestamp is the triggering event's
timestamp. Terminal completion is always checkpointed even when its event count
does not otherwise match the interval.

The journal retains checkpoint warnings and exposes them through the final
`CycleRunResult`. Existing omitted-option calls still perform named round and
terminal checkpoints and retain their previous warning behavior.

Public tests cover intervals zero and one, terminal-prefix identity, write
counts, invalid values, and zero writes on validation failure.

## Contract under test

The authoritative durable fact is the committed `PatchAccepted` event. A
checkpoint is a validated projection of a durable event prefix and is never a
replacement source of truth.

Each row begins from the same seeded controller boundary used by H03C:

```text
event:ModeOutcomeCommitted:after-state-before-dispatch
```

The initial graph is revision 1. One accepted patch admits one dynamic node and
creates revision 2. The campaign explicitly checkpoints every event using
interval 1 so that `PatchAccepted` immediately reaches all three checkpoint
fault boundaries.

The product is closed:

```text
PatchAccepted
  x 3 checkpoint stages
  x 5 fault kinds
  = 15 executable obligations
```

Every row requires exactly one planner call before the fault, a committed
sequence-12 `PatchAccepted`, a recoverable valid checkpoint prefix, revision 2
after recovery, one settlement, one round commit, one terminal event, and one
final latest checkpoint matching the terminal event prefix.

## Checkpoint stages

The retained stages are:

1. `before-checkpoint-construction`;
2. `after-checkpoint-construction`; and
3. `after-checkpoint-save`.

Each stage contributes exactly five rows, one for each retained fault kind.

The first two are pre-save checkpoint boundaries. The event is already
committed, but the new checkpoint is not. The store must retain the prior valid
checkpoint at sequence 11, exactly one event behind `PatchAccepted` at sequence
12.

The final stage is post-save. Both event and checkpoint are committed. The
stored checkpoint must target sequence 12 and carry the exact
`PatchAccepted` record hash as its history-prefix hash.

## Fault kinds and public signals

The five retained fault kinds are:

| Fault kind | Required signal | Rows |
|---|---|---:|
| `process-loss` | `coordinator-process-lost` | 3 |
| `store-error` | `durable-store-error` | 3 |
| `timeout` | `operation-deadline-exceeded` | 3 |
| `cancellation` | `operation-cancelled` | 3 |
| `commit-then-throw` | `commit-acknowledgement-lost` | 3 |

The campaign unwraps bounded error causes and requires the exact signal. A
generic thrown exception does not satisfy a row.

At these checkpoint boundaries, a fault kind describes the coordinator-visible
failure signal. The durability classification comes from the checkpoint stage,
not from the signal name. In particular, every row has a committed authoritative
event, including `store-error` and `process-loss` signals.

## Canonical matrix identity

The fixture validator and both native campaigns require:

- 15 ordered entries;
- three distinct checkpoint stages;
- five distinct fault kinds;
- five entries per stage;
- three entries per fault kind;
- ten `event-committed` rows;
- five `event-and-checkpoint-committed` rows;
- 2,893 canonical UTF-8 bytes; and
- SHA-256
  `c6a79bb3c8ce003f9c5968b39486e4bd1edcb5ff4cc7d87ae26ba810fd355381`.

The digest binds the complete ordered matrix, including boundaries,
durability labels, event type, fault kinds, and stages. Reordering, removing,
duplicating, relabeling, or adding a row changes the bytes and fails all three
closure layers.

## Linearization and authority

The event append and the checkpoint save are different linearization points.
The event append decides graph truth; the checkpoint save only decides whether
one derived acceleration artifact is available.

The exact stage outcomes are:

| Stage | Rows | Event committed | Checkpoint targets patch | Lag at fault | Writes at fault | Final writes |
|---|---:|---|---|---:|---:|---:|
| `before-checkpoint-construction` | 5 | yes | no | 1 event | 11 | 16 |
| `after-checkpoint-construction` | 5 | yes | no | 1 event | 11 | 16 |
| `after-checkpoint-save` | 5 | yes | yes | 0 events | 12 | 17 |

The pre-save rows intentionally recover from a checkpoint that is valid but
stale. Loading it cannot erase sequence 12 because recovery validates and folds
the authoritative suffix from the event store.

The post-save rows intentionally recover from a checkpoint that includes the
accepted event. Recovery validates its sequence, prefix hash, request identity,
controller identity, and derived state before using it as an acceleration
point.

No row treats the presence or absence of the sequence-12 checkpoint as proof
that the patch was accepted. That proof comes only from `PatchAccepted` in the
hash-linked event stream.

## Per-row recovery oracle

Every one of the 15 native outcomes records and cross-checks:

- the stable matrix index;
- the complete matrix entry;
- the exact injected boundary;
- the exact fault kind and observed public signal;
- whether the event committed at the fault;
- the interrupted event record hashes;
- the interrupted event-tail hash;
- the exact canonical `PatchAccepted` event at the fault;
- the exact canonical final accepted event;
- the checkpoint ID at the fault;
- the complete canonical checkpoint at the fault;
- whether that checkpoint targets `PatchAccepted`;
- checkpoint lag in event count;
- checkpoint writes at the fault;
- planner calls at the fault;
- final planner calls;
- the stable planner activity key;
- complete canonical final events;
- ordered final event types;
- complete final record hashes;
- the canonical terminal result;
- the independently projected final checkpoint;
- the final stored latest checkpoint;
- final checkpoint write count;
- replay zero-write status;
- terminal-resume zero-write status;
- terminal-resume handler count; and
- terminal-resume clock count.

The complete report is compared, not a reduced status vector. A runtime cannot
pass by returning the right final revision while differing in one event byte,
one record hash, one checkpoint byte, one planner call, or one recovery side
effect.

## Exactly-once recovery invariants

All 15 rows satisfy these uniform invariants:

- the `PatchAccepted` event is already committed at the injected boundary;
- sequence 12 is the accepted event sequence;
- the resulting graph revision is exactly 2;
- the accepted patch adds exactly one dynamic node;
- planner calls at the fault equal 1;
- planner calls after recovery still equal 1;
- the planner activity key remains stable;
- the patch budget settles exactly once;
- `RoundCommitted` occurs exactly once;
- `ControllerTerminated` occurs exactly once;
- the final history contains 18 events, sequences 0 through 17;
- the final latest checkpoint names sequence 17;
- the final latest checkpoint prefix hash equals the terminal record hash;
- replay writes zero records and dispatches zero handlers; and
- terminal resume writes zero records, dispatches zero handlers, and samples
  the clock zero times.

The final write-count difference is expected and meaningful. Pre-save faults
lose the attempted sequence-12 checkpoint and finish with 16 committed
checkpoint writes. Post-save faults retain it and finish with 17. Recovery does
not manufacture a second write to disguise the difference.

## Native implementation independence

The Python campaign executes the public Python controller and in-memory
persistence surfaces. The TypeScript campaign executes the public TypeScript
runtime and controller surfaces. Neither runtime imports or calls the other
runtime's implementation.

The shared runner parses the complete native Python JSON report, executes the
native TypeScript campaign, and performs deep strict equality across matrix,
required assertions, and all 15 outcomes.

An independently emitted Python H03D report from the immutable cold candidate
had:

```text
bytes  1045870
sha256 f29e88ee9c5abeb4548443166f12d55bef99a107b479013793e0d2f01937f780
```

The full cold conformance runner independently constructed the TypeScript
report and accepted complete equality with that 1,045,870-byte native Python
shape. The generated report remains reproducible evidence under `/tmp`; it is
not committed as a large derived blob.

## H03C regression lock

Generalizing the native patch campaign runners could have changed the already
accepted 35-row H03C report even if its summary counts remained unchanged. The
candidate therefore re-emitted that complete report from the clean detached
worktree.

The H03C output remained exactly:

```text
bytes  1855038
sha256 bd355d7edc5d9c9aab612897d80c0f288a409a31e1475c8f108f9b786d831399
```

Those values are byte-for-byte identical to the immutable H03C evidence. The
full conformance runner also executed all 35 H03C rows before accepting the 15
H03D rows.

## Independent fixture reconstruction

The repository fixture validator does not import either native campaign's
matrix builder. It independently reconstructs the `PatchAccepted` checkpoint
subset from the retained base durable-fault matrix and asserts:

- the exact event type;
- the exact three-stage membership;
- the exact five-fault membership;
- the exact 15-row product;
- exact counts per stage;
- exact counts per fault kind;
- exact ten-versus-five durability split;
- exact ordered canonical byte length;
- exact ordered canonical digest;
- the source-fault-matrix link;
- the seed boundary;
- the explicit interval-one schedule;
- the stale-prefix stage set;
- the exact-prefix stage set;
- lag-one expectations before save;
- lag-zero expectation after save;
- revision 1 to revision 2 transition;
- one accepted dynamic node;
- one committed planner call; and
- the complete required-assertion inventory.

This reconstruction prevents matching mistakes in both native runners from
silently redefining the retained contract.

## Public tests added

The TypeScript runtime suite derives the exact 15-row subset from the public
durable fault matrix, verifies the ten/five durability split, checks all five
fault kinds, and freezes both canonical byte count and digest.

The Python controller suite performs the equivalent matrix derivation. It also
adds explicit API behavior tests that:

1. run interval zero and prove one terminal latest checkpoint;
2. run interval one and prove one checkpoint per event;
3. compare the checkpoint sequence to the final event sequence;
4. compare the checkpoint prefix hash to the final event record hash;
5. reject boolean `True`;
6. reject negative one;
7. reject `9_007_199_254_740_992`; and
8. prove every rejected option writes zero events and zero checkpoints.

The conformance suites then execute all 15 native recoveries and compare the
complete reports. These layers separately catch structural fixture drift,
public scheduling drift, native recovery drift, and cross-language byte drift.

## Documentation contract

The normative cycle semantics now state:

- the exact 15-row matrix and digest;
- the event-stream authority rule;
- the stale-prefix versus exact-prefix checkpoint split;
- the revision-2 recovery guarantee;
- zero planner reinvocation;
- exactly-once settlement and termination;
- final latest-checkpoint identity;
- portable interval-zero and positive-interval behavior;
- Python's compatible omitted-option behavior; and
- the deterministic in-memory scope limitation.

Both runtime READMEs expose the retained fixture and portable scheduling
contract. The changelog records the new Python option and checkpoint campaign.

## Main shared-worktree verification

The following gates passed before the implementation candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 188, CLI 147; **783 total** |
| Python tests | **1,096 passed plus 2 subtests** |
| Python Ruff and Mypy | passed across 39 package/report source files |
| targeted controller tests | TypeScript 188; Python 60 |
| fixture validation | shared dirty worktree 59 JSON fixtures and 24 case manifests; all 15 H03D rows passed |
| documentation links | shared dirty worktree 258 links passed |
| cross-language conformance | all existing families, 35 H03C rows, and 15 H03D rows passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven manifests and dry-run tarballs passed |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both isolated installs passed |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | `git diff --check` passed |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work owned by other ongoing tasks. None of those paths is
part of the candidate. Only the detached-candidate results below are immutable
H03D evidence.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h03d-verify.WEc9ec`

The worktree was created at the full candidate object ID without attaching the
feature branch. Dependencies were installed from committed lock state:

```text
corepack pnpm install --frozen-lockfile
uv sync --project python --extra dev --frozen
```

The cold verification included:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `corepack pnpm lint`;
4. `corepack pnpm typecheck`;
5. `python/.venv/bin/python -m pytest -q`;
6. Ruff across Python package source, tests, and five cycle conformance
   reporters;
7. Mypy across Python package source and five cycle conformance reporters;
8. `node scripts/validate-fixtures.mjs`;
9. `node scripts/check-doc-links.mjs`;
10. `corepack pnpm check:release-map`;
11. `corepack pnpm check:evidence-closure`;
12. `node tools/conformance/run.mjs`;
13. independent H03D Python report emission and hashing;
14. independent H03C regression report emission and hashing;
15. `corepack pnpm check:packages`;
16. `corepack pnpm check:packed-install`;
17. `uv build --project python`;
18. `python/.venv/bin/python scripts/check-python-artifacts.py`;
19. `corepack pnpm audit:prod`; and
20. clean status, whitespace, exact commit, and exact tree checks.

### Exact cold results

- all seven TypeScript builds, lint jobs, and type checks passed;
- all **783 TypeScript tests** passed;
- all **1,096 Python tests plus two subtests** passed in 53.18 seconds;
- Ruff passed and Mypy found no issue in **39** source/report files;
- **56 committed JSON fixtures** and **21 committed case manifests** passed;
- 11 referenced YAML fixtures passed;
- one graph hash and one checkpoint hash passed;
- 14 durable JSON vectors and three compiled identities passed;
- nine graph-patch schema cases and 13 closed semantic vectors passed;
- all six D7 controller/revision/event/checkpoint schemas passed;
- all 16 chained event goldens passed;
- all 855 retained durable fault obligations passed fixture reconstruction;
- all 68 activity interruption obligations passed;
- all 25 public-operation interruption obligations passed;
- all 35 H03C patch-visibility obligations passed;
- all **15 H03D patch-checkpoint obligations** passed;
- both valid and both hostile lease transitions passed;
- both interrupted terminal/checkpoint folds passed;
- five in-doubt singleton cases passed;
- 18 terminal in-doubt resolution cases passed;
- the global-seen convergence fold and seven hard-stop folds passed;
- all 20 hostile histories and 11 hostile checkpoint folds passed;
- all five standalone phase-event shapes passed;
- **237 committed local Markdown links** passed;
- release mapping passed for **178/178** leaves and all **40** validator tests;
- evidence closure passed in audit-only mode and all **102** hostile subtests;
- cross-language conformance passed 14 graph fixtures;
- canonical-number conformance passed 24 RFC vectors, 13 portable values, 15
  public-boundary rejections, and 10,000 seeded finite bit patterns;
- compiler/builder whole-graph identity passed;
- runtime ready-queue behavior passed;
- invalid-output and cancellation conformance passed;
- eight settled-barrier cases passed;
- 12 route-selection cases passed;
- event/checkpoint persistence passed;
- event-sourced durable recovery passed;
- two terminal durable-history interop cases passed in both directions;
- eight bounded-pipeline cases passed;
- native-cycle conformance passed 132 exact baseline events and 24 activity
  inputs;
- all 855 structural obligations across 171 boundaries passed;
- all 100 executable lease-renew/release recoveries passed;
- all 68 exact activity cancellation/timeout recoveries passed;
- all 25 exact pause/resume/replay/fork interruption recoveries passed;
- all 35 exact H03C recoveries passed;
- all **15 exact H03D recoveries** passed;
- all three controller modes passed;
- both in-doubt recovery outcomes passed;
- the authority-bound terminal resolution passed;
- eight terminal results passed;
- one accepted GraphPatch/revision passed;
- one crash/takeover resume passed;
- eight baseline checkpoints passed;
- authoring conformance passed two four-path equivalence cases with six native
  reports, six valid-source cases, 21 builder diagnostics, 77 source failures,
  13 typed diagnostics, and ten identity mutations;
- the independent H03D report was 1,045,870 bytes with the expected digest;
- the independent H03C report was 1,855,038 bytes with its unchanged digest;
- all seven npm package manifests and dry-run tarballs passed;
- all seven npm tarballs installed in isolation at `0.1.0-alpha.1`;
- workspace dependencies were rewritten and installed bins passed smoke tests;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- both Python artifacts built and installed in isolated Python 3.14.0
  environments;
- entry points, shared YAML authoring, `validate`, and `doctor` passed;
- the production dependency audit reported no known vulnerability at the
  configured moderate threshold;
- `git diff --check` emitted no error; and
- `git status --short` was empty in the detached candidate.

The final cold identity check returned exactly:

```text
HEAD a41cbb64a4b745525c15753838fe17b756dd4bb7
tree eb3a500a9a0976bb3cb5b87c9b751357025200e2
```

No candidate source, fixture, test, documentation, or lock file was changed to
obtain a passing result. The cold run produced only ignored build artifacts.

## Artifact and supply-chain verification

The npm content gate checked all seven public package manifests and dry-run
tarballs. The packed-install gate installed all seven generated tarballs in an
isolated consumer, rewrote workspace dependencies to packed versions, and
smoke-tested installed command bins.

The Python gate built both distribution formats from the candidate. It checked
41 wheel entries and 42 sdist entries, installed each independently, and ran
entry-point, shared YAML authoring, `validate`, and `doctor` smoke tests.

The production dependency audit found no known vulnerability at the configured
moderate threshold. These checks establish candidate packaging integrity; they
do not constitute a future registry-publication guarantee.

## Shared-worktree isolation

The primary worktree contains unrelated preserved D4/D9/D10 planning, registry,
review, schema, fixture, and progress-scanner work. H03D did not stage, rewrite,
delete, or claim those paths.

The implementation commit was assembled from the exact 16-path allowlist in
this record. The evidence commit is limited to this single review file. Cold
verification at the detached object proves the candidate does not depend on
the unrelated dirty paths.

## Review limitations

The three configured subagents could not execute a new independent review
because their quotas were exhausted until 2026-08-02 15:10. This milestone has
producer self-review and independent deterministic oracles, but no independent
human or agent acceptance.

A future reviewer should independently reconstruct the three-by-five product,
mutate stale checkpoint sequence and prefix hashes, corrupt exact checkpoints,
force request/controller identity mismatches, remove the sequence-12 event,
attempt planner reinvocation, duplicate settlement, test interval overflow at
all three entry points, and reproduce this exact candidate from a clean clone.

## Explicit exclusions and next fault tranche

H03D excludes:

- real filesystem write, flush, `fsync`, rename, and directory durability;
- database transaction isolation and replica lag;
- object-store read-after-write and list consistency;
- multi-process writers and cross-host lease races;
- operating-system process termination during a real store syscall;
- actual provider cancellation or timeout acknowledgement;
- corrupted checkpoint payloads beyond existing hostile checkpoint suites;
- every structural durable-fault row outside this selected 15-entry product;
- load, performance, soak, and chaos benchmarks;
- compatibility with stores that do not implement the documented contract;
- independent security review;
- independent release acceptance;
- registry publication; and
- completion of the full master plan.

The broader retained structural matrix still contains obligations outside H03C
and H03D. Subsequent work should prioritize production store adapters and their
durability contracts, process-level chaos around event/checkpoint boundaries,
remaining high-risk structural rows, and independent replay/fork review. Each
future tranche needs its own closed fixture, oracle, immutable candidate, and
cold evidence rather than inheriting this result by implication.

## Milestone conclusion

H03D is accepted for the immutable candidate
`a41cbb64a4b745525c15753838fe17b756dd4bb7`.

The bounded outcome is exact: 15 checkpoint-stage/fault combinations execute
in both native runtimes; the fixture independently reconstructs and hashes the
product; all rows retain the committed `PatchAccepted` authority; stale and
exact checkpoints converge to revision 2 without planner reinvocation;
settlement, round commit, and termination remain exactly once; complete native
reports match; H03C remains byte-identical; and the candidate passes complete
cold unit, static, fixture, documentation, conformance, packaging, installation,
and audit gates.

The wider Graph Engineering goal remains active. This record is evidence for
one verified fault-campaign milestone, not a claim that the repository, D7,
the 21-day plan, or the 5K-star adoption objective is complete.
