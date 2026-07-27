# D7 H03C PatchAccepted durable-visibility fault-campaign evidence

Date: 2026-07-27

Milestone: H03C, PatchAccepted decision-to-durable-visibility fault campaign

Disposition: accepted as an immutable, bounded implementation milestone

Candidate commit: `59300f5d4d1993181d587663ca52ffeea7a42f47`

Candidate tree: `59cadc218e9413c6c776d8154a8e9826f4878a62`

Candidate parent: `790d4e7712e6d8286f3194af4e3326a4108127b4`

Branch: `feat/authoring-foundation`

Producer and self-reviewer: `/root`

Independent reviewer: unavailable; all three delegated-agent execution quotas
were exhausted until 2026-08-02 15:10.

## Decision

The exact candidate above is accepted as the H03C implementation candidate.
It converts the 35 already enumerated `PatchAccepted` durable-fault obligations
into executable, cross-language recovery evidence. The campaign exercises every
combination of seven decision-visibility stages and five fault kinds, proves
the pre-commit versus committed linearization split, and compares complete
Python and TypeScript outcomes down to canonical event, result, checkpoint,
and record-hash bytes.

This decision does **not** close D7, the 21-day plan, the release roll-up, or
the complete cycle fault program. In particular, the three checkpoint-write
stages remain explicitly outside this campaign and are reserved for H03D.
Production-store durability, real provider cancellation, multi-process chaos,
and independent acceptance also remain open.

No runtime source behavior was changed in this milestone. The implementation
adds a retained campaign and hostile oracles around the existing controller
semantics. That distinction matters: passing H03C demonstrates the enumerated
contract under deterministic in-memory fault injection; it is not evidence
that every production storage or process-loss mechanism is complete.

## Immutable candidate provenance

The candidate was committed only after the shared-worktree campaign, complete
unit suites, static checks, fixture reconstruction, full conformance runner,
release-map checks, package audits, and artifact installation checks passed.
It was then reproduced in a clean detached worktree created at the full
40-character object ID.

Git identified the candidate as follows:

```text
commit 59300f5d4d1993181d587663ca52ffeea7a42f47
tree   59cadc218e9413c6c776d8154a8e9826f4878a62
parent 790d4e7712e6d8286f3194af4e3326a4108127b4
author reacher-z <mtrxcop@gmail.com>
committer reacher-z <mtrxcop@gmail.com>
subject execute patch visibility fault campaign
body   empty
```

The implementation commit contains ten files, 1,324 insertions, and four
deletions. It carries no `Co-authored-by` trailer and no additional message
body.

## Exact committed scope

| Path | Candidate SHA-256 | Role |
|---|---|---|
| `packages/runtime/README.md` | `8359850b11d3447d5886a19a9e906602f81c3dc584de8095cac35138cb2929c9` | TypeScript public campaign documentation |
| `packages/runtime/test/cycle-controller.test.ts` | `c5625679faf50e13c19d137f667ff5ad04a09553adb281a88907dfd426e409b4` | TypeScript matrix and execution tests |
| `python/README.md` | `8198c53e5cdb8c780433866d5d12f1a25ce54be123fc0a1717b063b306da7503` | Python public campaign documentation |
| `python/tests/test_cycle_controller.py` | `79cf862dfc460e44850d2eb0cc432c30a2548f886fc0b18dc5f30fd504849e7d` | Python matrix and execution tests |
| `scripts/validate-fixtures.mjs` | `51234cb85e0a56d88426fa12e51e800e4d52cf1f2979500c63345257712ac1ba` | independent fixture-product reconstruction |
| `spec/conformance/cycle-controller-patch-visibility-fault.case.json` | `9ce3e6507a0751aaee0b0c7d90a5d4dac2722354927ad2fbdeb5ce3d5bdff575` | retained H03C contract |
| `spec/cycle-semantics.md` | `311911f45d38aa4db7aa08a7977171e4f92b125122e98ab2f71c362b38e4e9d2` | normative linearization and recovery semantics |
| `tools/conformance/cycle_patch_visibility_fault.mjs` | `278d113edc266d301964723256e1f7b717c63266f9043c61913278149223ea97` | native TypeScript campaign runner |
| `tools/conformance/python_cycle_patch_visibility_fault_report.py` | `aa00f8cf5b332f85a5866c19830df9fd727b24f3bcf049d56b09fe74d715b6c4` | native Python campaign reporter |
| `tools/conformance/run.mjs` | `434d659db3ae759b193cacc63144411e6041ad997bfc90901f141af89980eaca` | cross-language deep-equality integration |

The retained fixture is 2,656 bytes and has SHA-256
`9ce3e6507a0751aaee0b0c7d90a5d4dac2722354927ad2fbdeb5ce3d5bdff575`.

## Contract under test

The authoritative durable fact is `PatchAccepted`. The campaign starts from a
seeded controller history immediately after
`event:ModeOutcomeCommitted:after-state-before-dispatch`, then executes the
patch-planner decision through one injected fault boundary.

The initial graph is revision 1. A successful patch admits exactly one dynamic
node and produces revision 2. Each final history must include exactly one
accepted patch decision, exactly one patch budget settlement, exactly one
accepted round commit, and exactly one controller termination.

The campaign is a closed Cartesian product:

```text
PatchAccepted
  x 7 visibility stages
  x 5 fault kinds
  = 35 executable obligations
```

### Visibility stages

1. `before-event-construction`
2. `after-event-construction`
3. `after-prospective-fold`
4. `before-store-commit`
5. `after-store-commit`
6. `after-store-return`
7. `after-state-update`

Each stage contributes exactly five rows.

### Fault kinds

1. `process-loss`
2. `store-error`
3. `timeout`
4. `cancellation`
5. `commit-then-throw`

Each fault kind contributes exactly seven rows.

### Canonical matrix identity

The fixture validator and both native campaigns require:

- 35 entries;
- seven distinct visibility stages;
- five distinct fault kinds;
- five entries per stage;
- seven entries per fault kind;
- 6,249 canonical UTF-8 bytes; and
- SHA-256
  `160ed0853f3da4783f39440b7d3ade46b56a1d83f47248be2cb97a37dc46dfd2`.

This digest binds the ordered matrix, not merely the set of stage and fault
names. Reordering an entry, changing one boundary classification, removing a
row, or adding an unreviewed row changes the canonical identity and fails the
campaign.

## Decision linearization

The first four visibility stages occur before the `PatchAccepted` append has
committed:

- `before-event-construction`;
- `after-event-construction`;
- `after-prospective-fold`; and
- `before-store-commit`.

These stages produce 20 `event-not-committed` outcomes. The interrupted store
prefix contains no `PatchAccepted`. Recovery may re-invoke the planner because
there is no durable decision to replay, but it must reuse the stable
patch-planner activity key and the planner must be idempotent. The campaign
requires exactly two total planner calls: the interrupted attempt and the
recovery attempt.

The final three visibility stages occur after the append has committed:

- `after-store-commit`;
- `after-store-return`; and
- `after-state-update`.

These stages produce 15 `event-committed` outcomes. The durable prefix already
contains the exact `PatchAccepted` record even when the coordinator did not
observe a successful return. Recovery must fold the stored decision, restore
revision 2, and perform zero patch-planner re-invocations. The campaign
therefore requires exactly one total planner call.

The store commit is the linearization point. In-memory state update and caller
acknowledgement do not override the durable event stream. This prevents both
lost accepted patches and duplicate patch decisions after ambiguous failures.

## Fault signals

Each injected row must expose its exact public signal before recovery:

| Fault kind | Required signal |
|---|---|
| `process-loss` | `coordinator-process-lost` |
| `store-error` | `durable-store-error` |
| `timeout` | `operation-deadline-exceeded` |
| `cancellation` | `operation-cancelled` |
| `commit-then-throw` | `commit-acknowledgement-lost` |

The campaign unwraps bounded error causes and rejects a row if the injected
fault cannot be found. It does not accept a generic exception as equivalent
evidence.

## Per-row recovery oracle

Every one of the 35 rows records and cross-checks:

- the exact matrix entry and stable row index;
- the observed fault signal;
- the expected committed/not-committed classification;
- the interrupted durable-history prefix hash;
- every interrupted record hash;
- the exact canonical target event visible at the fault boundary, or `null`
  for a pre-commit boundary;
- the exact final canonical `PatchAccepted` event;
- planner calls at the boundary and after recovery;
- the stable patch-planner activity key;
- the complete canonical terminal result;
- the ordered final event-type sequence;
- the canonical bytes of every final event;
- every final record hash;
- the complete canonical final checkpoint;
- replay write count;
- terminal-resume write count;
- terminal-resume handler-dispatch count; and
- terminal-resume clock-sampling count.

The target event at the fault boundary is a deliberately separate oracle. For
20 pre-commit rows it must be `null`. For 15 committed rows it must equal the
canonical bytes of the final accepted event. This prevents a weaker report
from claiming committed recovery solely because the eventual terminal result
looks right.

## Exactly-once settlement and termination

Every recovered row requires one and only one:

- `PatchAccepted`;
- patch settlement with attempt count 1, cost USD 0, and dynamic-node delta 1;
- `RoundCommitted`; and
- `ControllerTerminated`.

The accepted patch must restore the exact graph revision and revision identity
from durable bytes. A second settlement, second accepted decision, second
round commit, or second terminal event fails the report even if the controller
returns a superficially valid terminal value.

The final replay is read-only. A terminal resume is also required to perform:

- zero event-store writes;
- zero activity-handler dispatches; and
- zero clock samples.

The clock and handlers are wired to throw if called, so a recorded zero is not
derived only from a passive counter.

## Cross-language evidence

The Python campaign is implemented through the public native Python controller
and persistence surfaces. The TypeScript campaign is implemented through the
public native TypeScript runtime and controller surfaces. Neither runtime
imports the other runtime's result.

`tools/conformance/run.mjs` parses the complete Python JSON report, executes
the TypeScript campaign, and performs a deep strict comparison of the complete
reports. Summary counts alone cannot satisfy the gate.

An independently emitted Python report from the immutable cold candidate had:

```text
bytes  1855038
sha256 bd355d7edc5d9c9aab612897d80c0f288a409a31e1475c8f108f9b786d831399
```

The full cold conformance runner then constructed the TypeScript report and
accepted deep equality with that native Python shape. The report is retained
as reproducible generated evidence rather than committed as a 1.8 MiB blob.

## Independent fixture reconstruction

The main fixture validator does not import either campaign's matrix builder.
It reconstructs the expected `PatchAccepted` product from the retained base
fault matrix and asserts:

- exact stage membership;
- exact fault-kind membership;
- exact row count;
- exact per-stage counts;
- exact per-fault counts;
- exact pre-commit versus committed counts;
- exact canonical byte length;
- exact canonical digest;
- valid source-fault-matrix linkage;
- known seed boundary;
- complete required-assertion inventory; and
- exclusion of checkpoint-specific visibility stages.

This reconstruction means a shared implementation error in both native
campaign runners cannot silently redefine the fixture's closed product.

## Public tests added

The TypeScript runtime suite now checks that the public durable-fault matrix
derives the exact 35-row subset and executes the full native TypeScript
campaign.

The Python controller suite performs the equivalent native Python derivation
and complete campaign execution. Both test suites consume the retained
fixture, while the cross-language runner adds complete report equality.

The test layers therefore cover three distinct failure classes:

1. structural matrix drift;
2. native recovery-semantic drift; and
3. cross-language canonical-output drift.

## Documentation contract

The cycle semantics document now states the `PatchAccepted` commit
linearization rule and the distinct recovery behavior on each side of it. Both
public runtime READMEs point users to the retained fixture and describe the
pre-commit stable-key replan versus committed zero-replan guarantee.

The documentation intentionally names the checkpoint-stage exclusion. It does
not imply that H03C covers checkpoint append/return/state visibility.

## Main shared-worktree verification

The following gates passed against the completed implementation before the
immutable candidate was committed:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 187, CLI 147; **782 total** |
| Python tests | **1,090 passed plus 2 subtests** |
| Python Ruff and Mypy | passed across 38 package/report source files |
| targeted controller tests | TypeScript 187; Python 54 |
| fixture validation | shared dirty worktree 58 JSON fixtures and 23 case manifests; all 35 patch-visibility obligations passed |
| documentation links | shared dirty worktree 256 links passed |
| cross-language conformance | all 35 PatchAccepted rows plus every existing conformance family passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven manifests and dry-run tarballs passed |
| packed npm install | all seven tarballs installed and exported bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both isolated installs passed |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | `git diff --check` passed |

The shared-worktree fixture and documentation totals include preserved,
uncommitted D4/D9/D10 work owned by other ongoing tasks. Those files were not
staged or included in the H03C candidate. Only the detached-candidate totals
below are used as immutable verification evidence.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h03c-verify.ZlqbjP`

The worktree was created at the exact candidate object ID with no branch.
Dependencies were installed only from committed lock state:

```text
corepack pnpm install --frozen-lockfile
uv sync --project python --extra dev --frozen
```

The cold verification order was:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `corepack pnpm lint`;
4. `corepack pnpm typecheck`;
5. `python/.venv/bin/python -m pytest -q`;
6. Ruff across Python package source, tests, and four cycle conformance
   reporters;
7. Mypy across Python package source and four cycle conformance reporters;
8. `node scripts/validate-fixtures.mjs`;
9. `node scripts/check-doc-links.mjs`;
10. `corepack pnpm check:release-map`;
11. `corepack pnpm check:evidence-closure`;
12. `node tools/conformance/run.mjs`;
13. `node scripts/check-package-contents.mjs`;
14. `node scripts/check-packed-install.mjs`;
15. `uv build --project python`;
16. `python3 scripts/check-python-artifacts.py`;
17. `corepack pnpm audit --prod --audit-level moderate`; and
18. `git status --short`, `git diff --check`, exact commit, and exact tree
    checks.

### Exact cold results

- all seven TypeScript builds, lint jobs, and type checks passed;
- all **782 TypeScript tests** passed;
- all **1,090 Python tests plus two subtests** passed;
- Ruff passed and Mypy found no issue in **38** source/report files;
- **55 committed JSON fixtures** and **20 committed case manifests** passed;
- 11 referenced YAML fixtures passed;
- all 855 retained durable-fault obligations passed their fixture checks;
- all 68 activity-interruption obligations passed;
- all 25 public-operation-interruption obligations passed;
- all **35 PatchAccepted visibility obligations** passed;
- **235 committed local Markdown links** passed;
- release mapping passed for **178/178** leaves and all **40** validator tests;
- evidence closure passed in audit-only mode and all **102** hostile subtests;
- the cross-language runner passed 14 graph fixtures;
- canonical-number conformance passed 24 RFC vectors, 13 portable values, 15
  public-boundary rejections, and 10,000 seeded finite bit patterns;
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
- all **35 exact PatchAccepted visibility fault recoveries** passed;
- all three cycle-controller modes passed;
- both in-doubt recovery outcomes passed;
- the authority-bound terminal resolution passed;
- eight terminal results passed;
- one accepted GraphPatch/revision passed;
- one crash/takeover resume passed;
- eight baseline checkpoints passed;
- authoring conformance passed two four-path equivalence cases with six native
  reports, six valid-source cases, 21 builder diagnostics, 77 source failures,
  13 typed diagnostics, and ten identity mutations;
- all seven npm package manifests and dry-run tarballs passed;
- all seven npm tarballs installed in isolation and their installed bins passed
  smoke tests;
- workspace dependencies were rewritten correctly during packed installation;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- both Python artifacts installed in isolation under Python 3.14.4;
- console entry points, shared YAML authoring, `validate`, and `doctor` passed;
- the production dependency audit reported no known vulnerability at the
  configured moderate threshold; and
- the detached worktree remained clean with no whitespace errors.

The final cold identity check returned exactly:

```text
HEAD 59300f5d4d1993181d587663ca52ffeea7a42f47
tree 59cadc218e9413c6c776d8154a8e9826f4878a62
```

No candidate file was changed to obtain a passing cold result. The detached
worktree produced only ignored build outputs used by the artifact gates.

## Shared-worktree isolation

The primary worktree contained unrelated, preserved D4/D9/D10 planning,
registry, review, schema, and fixture work. H03C did not stage, rewrite, delete,
or claim those files. The implementation commit was assembled from the exact
ten-path allowlist above, and the evidence commit is limited to this review
file.

The cold verification is the authoritative answer to whether H03C depends on
those unrelated dirty files: it does not.

## Review limitations

The three configured subagents could not run a new independent review because
their execution quotas were exhausted until 2026-08-02 15:10. The milestone
therefore has producer self-review plus deterministic hostile oracles, not
independent human or agent acceptance.

A future independent reviewer should reconstruct the seven-by-five product,
challenge the store-commit linearization boundary, mutate committed prefixes,
force planner-key drift, attempt duplicate settlement, compare the complete
native reports, and reproduce this exact commit from a clean checkout.

## Explicit exclusions and next fault tranche

H03C excludes:

- `before-checkpoint-write`;
- `after-checkpoint-write`;
- `after-checkpoint-return`;
- real filesystem `fsync` and directory-entry durability;
- database transaction isolation and replication lag;
- network partitions and multi-process store ownership races;
- actual provider-side cancellation and timeout acknowledgement;
- process termination by the operating system;
- every structural fault row outside the selected 35-entry product;
- performance, load, soak, and chaos results; and
- independent release acceptance.

The checkpoint-specific visibility stages form H03D. They require their own
linearization contract because a checkpoint is a derived acceleration artifact,
whereas `PatchAccepted` is an authoritative event. H03D must prove that an
absent, stale, ambiguously acknowledged, or post-commit checkpoint cannot
replace or contradict the hash-linked event stream.

## Milestone conclusion

H03C is accepted for the immutable candidate
`59300f5d4d1993181d587663ca52ffeea7a42f47`.

The bounded result is strong: 35 closed visibility/fault combinations execute
in both native runtimes, the fixture independently reconstructs the product,
the reports compare complete canonical histories and checkpoints, pre-commit
recovery reuses one stable idempotency key, committed recovery performs no
planner call, settlement occurs once, and terminal replay/resume stay inert.

The broader Graph Engineering goal remains active. This evidence must be read
as one verified fault-campaign milestone, not as a claim that the master plan
or stable release is complete.
