# D7-H05C hostile GraphPatch replay/restore campaign evidence

Date: 2026-07-27

Milestone: D7-H05C, hostile durable GraphPatch decision replay, restore, lineage,
limit, and complete-evidence idempotency validation

Disposition: accepted as an immutable, bounded implementation milestone

Candidate commit: `fb32398faa8d918a01e9e9ca87af605236f44745`

Candidate tree: `f584279ce330bea2a9c49a18b88f61db9dc5dbdb`

Candidate parent: `5c9be9489048a3a89a392b80cdd7a3864a61a469`

Branch: `feat/authoring-foundation`

Producer and self-reviewer: `/root`

Independent reviewer: unavailable. The three already delegated agents were
platform-quota blocked until 2026-08-02 15:10 and were not repeatedly retried.

## Acceptance decision

The exact candidate above is accepted as the D7-H05C implementation candidate.
It makes durable GraphPatch restoration a first-class closed trust boundary in
both native runtimes and adds one frozen cross-language campaign that attacks
complete accepted/rejected decision evidence rather than only live proposals.

The retained campaign contains:

- 34 unique ordered cases;
- 27 fail-before-mutation hostile carrier or lineage attacks;
- seven stateful restore/idempotency behaviors;
- ten closed categories;
- 14 mandatory assertions;
- four independently generated, byte-identical native seed carriers;
- one frozen canonical case-array byte count and digest;
- one independent repository fixture validator;
- one native TypeScript restore runner;
- one independently implemented native Python restore runner; and
- one cross-language join that deep-compares the complete reports.

Every one of the 27 isolated attacks is required to:

- produce `GE_CYCLE_INVALID_HISTORY`;
- preserve graph revision 1;
- preserve the original four-node diamond graph;
- preserve a zero dynamic-node counter;
- record no patch decision; and
- agree between TypeScript and Python on the exact input bytes and hash.

The seven stateful cases additionally require accepted and rejected restore,
post-winner stale-rejection restore, two accepted revisions in sequence,
immediate and historical exact duplicate reuse, and a complete-evidence
duplicate conflict that preserves the first restored record.

This is a bounded **H05C replay/restore** result. It does not close the complete
D7 production checklist, distributed-store correctness, replay/fork lineage
trees, checkpoint acceleration, scheduler revision handoff, D9 protected
operator views, stable release, or the complete 21-day master plan.

## Why this slice was selected

H05A established hostile portable shape capture with 54 attacks. H05B then
established schema-valid semantic decisions with 24 cases. The master plan's
D7 production gate still explicitly required replay and restore.

Before this candidate, the TypeScript restore path already validated much of a
recorded decision, and the Python event fold validated controller history, but
there was no closed retained campaign proving that both native GraphPatch
runtime restore APIs:

- accepted identical complete durable carriers;
- rejected identical carrier mutations;
- reconstructed the same coordinate and graph cardinality;
- enforced cumulative dynamic-node and graph limits before exposure;
- recovered a legitimate stale-loser record after its accepted winner;
- reused an old exact decision after later accepted revisions; and
- rejected a complete-evidence conflict without replacing the first record.

The candidate closes that bounded omission with executable evidence instead of
changing an existing checklist cell by assertion.

## Defects and hardening exposed by the campaign

### TypeScript stale-rejection restore lineage

`NativeGraphPatchApplier.restoreRecorded()` previously required every new
recorded decision's requested base to equal the current coordinate. That rule
made a legitimate one-winner history impossible to restore: after the accepted
winner advances the coordinate, the recorded `GE_PATCH_STALE_BASE` loser must
still reference the old coordinate that made it stale.

The repair now distinguishes:

- a stale rejection, whose requested base must differ from current state; and
- every other new decision, whose requested base must equal current state.

Exact duplicate detection remains before lineage evaluation. Therefore a
historical accepted decision can be replayed as a no-op after later revisions
without being misclassified as stale history. Internally inconsistent stored
lineage now returns `GE_CYCLE_INVALID_HISTORY`, not the live decision code
`GE_PATCH_STALE_BASE`.

### TypeScript closed durable error-code vocabulary

The recorded-decision validator previously accepted any diagnostic matching a
`GE_*` regular expression and any rejected outcome matching a `GE_PATCH_*`
regular expression. A re-signed history could therefore introduce a code that
looked syntactically plausible but was not part of the stable GraphPatch
protocol.

The candidate closes both fields over the nine public GraphPatch codes:

- `GE_PATCH_INVALID`;
- `GE_PATCH_STALE_BASE`;
- `GE_PATCH_IDEMPOTENCY_CONFLICT`;
- `GE_PATCH_DUPLICATE_ID`;
- `GE_PATCH_GRAPH_INVALID`;
- `GE_PATCH_AUTHORITY_EXPANSION`;
- `GE_PATCH_BUDGET_EXCEEDED`;
- `GE_PATCH_STATE_CONFLICT`; and
- `GE_PATCH_UNSUPPORTED`.

### Python complete durable-carrier validation

`GraphPatchRuntime.restore()` previously decoded and shape-validated the stored
patch and rebuilt accepted graphs, but it did not independently close every
carrier field before consuming it. The candidate adds a complete validation
boundary for:

- accepted/rejected event-data key sets;
- event type and outcome consistency;
- iteration and duration bounds;
- inline payload disposition, redaction claim, encoding, canonical JSON, byte
  length, and SHA-256;
- patch schema, ID, hash, and requested-base equality;
- the exact nine-field authority snapshot;
- independent planner-activity binding;
- policy snapshot hash;
- exact requested, committed, and released three-axis budgets;
- budget reconciliation;
- bounded diagnostics, known codes, phases, and JSON Pointers;
- accepted diagnostic, node-accounting, and revision-chain invariants;
- rejected diagnostic, error-code, and zero-dynamic-commit invariants; and
- error normalization to `GE_CYCLE_INVALID_HISTORY`.

Accepted history is still recompiled after carrier validation. Graph hash,
revision hash, previous revision, patch hash, graph limits, and cumulative
dynamic-node limits must all pass before state becomes visible.

## Immutable candidate provenance

Git identifies the implementation candidate as:

```text
commit fb32398faa8d918a01e9e9ca87af605236f44745
tree   f584279ce330bea2a9c49a18b88f61db9dc5dbdb
parent 5c9be9489048a3a89a392b80cdd7a3864a61a469
author reacher-z <mtrxcop@gmail.com>
committer reacher-z <mtrxcop@gmail.com>
subject add hostile graph patch restore campaign
body   empty
```

The candidate contains 13 files, 1,866 insertions, and 23 deletions. It has no
`Co-authored-by` trailer and no commit-message body.

## Exact committed scope

| Path | Candidate SHA-256 | Role |
|---|---|---|
| `CHANGELOG.md` | `25c5aa96e321bb7b33a3ca21baaf5d15dfda9e7845f49ba8afdefb7343a1e0de` | public H05C change record |
| `README.md` | `e18e64b446c0dd59d4448f18842dd91a1d7ad626f07182cbb5a91c0406c7d1e0` | repository-level corpus claim |
| `codex_plans/Graph-Engineering-21-Day-Master-Plan.md` | `df8cc8d5b12723a8c35fc7fad4ae98887ca0e6549512034af6522c4e807dd242` | append-only section 31.27 execution contract |
| `packages/runtime/src/graph-patch.ts` | `b34f6da75cfb4d5bcb51f8ebb11ee0197a03effced8950916548442509c5d34f` | TypeScript history, code-vocabulary, and stale-lineage repair |
| `packages/runtime/test/graph-patch.test.ts` | `d73d7d7d18b5b5e4f23e9aace2494d23c5449d7e741867804b3339180d53f726` | TypeScript 34-case retained test |
| `python/src/graph_engineering/graph_patch.py` | `1199a732a2c3bd722b10a09f728ba7f86a9f787844ddc21a1780045daafe5628` | Python complete durable-carrier validator |
| `python/tests/test_graph_patch_runtime.py` | `8045b9c7da19f89cae40c882e76904737f241d94e36aa02c398507f8fefe10ba` | Python 34-case retained test |
| `scripts/validate-fixtures.mjs` | `18ff40e82d44be7bdeef9f39e66a603ff6e60bc7916b7b62ca8747804a125fe7` | independent H05C vocabulary and digest validator |
| `spec/conformance/graph-patch-hostile-restore.case.json` | `ec1a0a046712cc8ead1140b968a060c6fc65ea36dd8f93c5b7e51cd237fab6a7` | retained 34-case H05C contract |
| `spec/cycle-semantics.md` | `76e88ded11b74c3ae99429694acc8fc7e1de643b7732e1e2090c8bb94503465c` | normative replay/restore semantics |
| `tools/conformance/graph_patch_hostile_restore.mjs` | `769e707dff451b9e15d2745e831a507393e536d1b4f75dd20ed6c30ca558322f` | native TypeScript scenario engine |
| `tools/conformance/python_graph_patch_hostile_restore_report.py` | `d6cb5336ed2daff58f025e4bc0e9e6031ed86b47a554eb608b65a73ee8955b08` | independent native Python scenario engine |
| `tools/conformance/run.mjs` | `a16ba8b69c82c4ca2ebb725547f47ed160136c894614634d554da4b29a403ba6` | complete-report cross-language join |

The three new retained files have these exact candidate sizes:

```text
fixture        76 lines   8,520 bytes
TS runner     390 lines  13,482 bytes
Python runner 540 lines  19,085 bytes
```

The master plan changed only by appending section 31.27: 224 inserted lines and
zero removed lines. No earlier plan content was changed.

## Closed fixture identity

The fixture ID is:

```text
graph-patch-hostile-restore-v1alpha1
```

The ordered 34-case descriptor array has:

```text
canonical UTF-8 bytes 6216
SHA-256                4e08a710822f20ad58e8ae563ebe21eeb9fdd98926e3c3c12fbafa575bd36372
```

The formatted fixture file has SHA-256:

```text
ec1a0a046712cc8ead1140b968a060c6fc65ea36dd8f93c5b7e51cd237fab6a7
```

The exact category counts are:

| Category | Cases |
|---|---:|
| shape | 2 |
| identity | 4 |
| lineage | 8 |
| authority | 4 |
| budget | 5 |
| diagnostic | 2 |
| outcome | 2 |
| limit | 2 |
| restore | 2 |
| idempotency | 3 |

The independent fixture validator closes all 34 scenario names, all case fields,
the accepted/rejected/mixed seed vocabulary, outcome vocabulary, error-code
presence, attack/behavior cardinality, category counts, required assertions,
canonical bytes, and digest.

## Byte-identical native seed carriers

Both native public appliers independently produced these complete carrier
identities before any hostile mutation:

| Seed | Canonical UTF-8 bytes | SHA-256 |
|---|---:|---|
| accepted | 2,821 | `22a34f5c4c91b93dead4650d0b53b815c069f110dcb35af00d9c125c3bcba835` |
| rejected | 2,432 | `052b156b11a98e4dbea3ee6affcf4290d008cb3d93a529f3398f9771a3ac13ab` |
| second accepted | 2,807 | `2b8e1fe73f7ceb20c78d2c74fc4a69c6aae1ce058c97cd3b27219d1d946b2f62` |
| stale after accepted | 2,456 | `f7043f4cc32fd7403a7e923bd90e6df427bc3b04234294f097e89dbe15ea35c0` |

The deterministic Python JSON report generated during verification was 31,117
bytes with SHA-256
`038c2e05e58a7d13b82875486d9b6811256689e3a136540ab40bb3c5c3679331`.
The TypeScript report was not normalized or projected before comparison;
`tools/conformance/run.mjs` required deep equality of the full parsed objects.

## Exact 34-case input and outcome matrix

All hashes below identify the complete canonical scenario input, including the
decision sequence, independently trusted planner keys, and target runtime
limits.

| # | Case | Kind | Input bytes | Input SHA-256 | Outcome / code | Final rev / decisions / dynamic / nodes |
|---:|---|---|---:|---|---|---|
| 0 | accepted-extra-field | attack | 3,078 | `662bb58eca2c124201b6ff0e100ba77f8bc509a020164a6e75432c703da05b10` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 1 | accepted-patch-id-drift | attack | 3,068 | `aa484acd85ce2734329bb7475f5b545176261177adf8ede744e1b89f51b3027f` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 2 | accepted-patch-hash-drift | attack | 3,062 | `538b0941699909893c3f68dfdd125aa16fd0e94f24d72996e4ee94d5a14fccc3` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 3 | accepted-payload-noncanonical | attack | 3,373 | `9004289498e0d9557c461b17336985d1798b4c66346bbf3006c915ab2ec5af2d` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 4 | accepted-payload-length-drift | attack | 3,062 | `88d3c97a2a22cfcd0d8c00ebb2a30cebc9fa816c15cec6fd9ece2c7afe4b9dd5` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 5 | accepted-requested-base-drift | attack | 3,062 | `2c2e71b2b49db243e2912f1a952ed66218d3033df6c5a9d82495b9d9e33aab08` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 6 | accepted-planner-key-mismatch | attack | 3,062 | `12c7315a04453e108a514bdc1e5612353289aeafa5f9ec663d82412f7c0e97bb` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 7 | accepted-authority-hash-invalid | attack | 3,008 | `4e31b5575a8dbc07be97baa3457f8491eacb397e08a8540ee025b828b1f78fad` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 8 | accepted-policy-hash-invalid | attack | 3,008 | `3cac717d69f6c657d4acf582617dbf7236b03711a66c7c3e2c12a484a7014678` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 9 | accepted-budget-negative | attack | 3,063 | `e4b5c1139946d5041a1887a0bd40ac33a3406f05ca99e6ae3e6b3fb2e5e92f61` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 10 | accepted-budget-unreconciled | attack | 3,062 | `371523426277a19fa2302fcc2957a738cc8f671352eb7405094b127f76e08b13` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 11 | accepted-dynamic-count-drift | attack | 3,062 | `1ef0b6f1339e4cfef03b92dcc4b3c168a46431a15b336f495a1118052ad2b51d` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 12 | accepted-diagnostics-present | attack | 3,109 | `8e55b5f4b96d09f853fa0572dd1201606407aea66ee32efb3e3a9a92a24c3730` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 13 | accepted-revision-skip | attack | 3,062 | `da2ea7a3a4b561b842f19a53f3066e335002a86b87f2925b761d767cd821bb80` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 14 | accepted-previous-hash-drift | attack | 3,062 | `0805eb6ad8381b0de8638f7bd41c4a8f9233452776654d6160941a8abe1cfd16` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 15 | accepted-revision-patch-hash-drift | attack | 3,062 | `2caf76ca1a562cb45ca51e63b37bbaad83dd325ff6f013a6ced9a6b0477d4779` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 16 | accepted-revision-hash-drift | attack | 3,062 | `04ff13bdb83795a065cb4f5274347735275ea38e0ceff5c64e52a183ba8a4708` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 17 | accepted-graph-hash-drift | attack | 3,062 | `0f39a4208a323f774334b426af0494badb436e59dd0b7b9e6a9a07e2c450c413` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 18 | accepted-over-dynamic-limit | attack | 3,061 | `2cf19987afecf1d947c955767bd2698b4905c7315df934e7739f57690916f9c2` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 19 | accepted-over-node-limit | attack | 3,060 | `73cdf19f2008c49e6bac51e0aa23af3aaf534fe05b8d2743df33701614a84bb5` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 20 | rejected-extra-field | attack | 2,689 | `4c2a4676115dbb176d56d63871df6063607222575c9ed1285c33527a7a5d0fe5` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 21 | rejected-diagnostics-empty | attack | 2,618 | `95024b778d30e7b16eb2f18f940968f8c6c6d6ceace8b3d3ea544f8e8857f9b0` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 22 | rejected-error-code-unknown | attack | 2,671 | `2e1b746feadb0b633224444076ba57fe04b8253772861b2ee6c201f4bf2a0dac` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 23 | rejected-dynamic-commit-nonzero | attack | 2,672 | `03d962de4168c219bdaaf988c58067688b6da5479b0f08bf372d0f40fc10d2b4` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 24 | rejected-outcome-mismatch | attack | 2,673 | `e422a3b699c0c7104030523be3959d43e5d9f77d4c99ee84f289a912691206a4` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 25 | rejected-planner-key-mismatch | attack | 2,673 | `f3b51e303565293e87eebd5902b8430df69e26cd5e4b156d07d46a5d88e0367a` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 26 | rejected-budget-unreconciled | attack | 2,673 | `c6fcd31a1c5efc02d40d6244502b3f0f2e13d5b183dd15c9d0c54ddef3281091` | rejected / invalid history | 1 / 0 / 0 / 4 |
| 27 | accepted-restore | behavior | 3,062 | `4c4a70402d9652970f4bc1526176b403e08901ac884ff72984ef7258f2747471` | restored | 2 / 1 / 1 / 5 |
| 28 | rejected-restore | behavior | 2,673 | `246723dc41a2e4ce7d067ae83d9a2fddc2543f5f52b53e3b383238d1824e240a` | restored | 1 / 1 / 0 / 4 |
| 29 | stale-rejection-after-accepted | behavior | 5,586 | `9cbe8e46cf75889e8c5664f0fde1291a45fcbbf020a18894efb77ccb5b0a3230` | restored | 2 / 2 / 1 / 5 |
| 30 | sequential-accepted-history | behavior | 5,937 | `bf20ad56d827108de387a140f8b9c6586534419028592426e17ad2220cfa8fd4` | restored | 3 / 2 / 2 / 6 |
| 31 | exact-accepted-duplicate | behavior | 5,951 | `2b33557f0ca818df7881f672af08a94869e8a6b38b6de8290393b86461ecd881` | duplicate reused | 2 / 1 / 1 / 5 |
| 32 | historical-accepted-duplicate | behavior | 8,826 | `8e4b3514ce2f812047092f956f590b35642a5fe4b020f9eac3da78d8f5fb1ffe` | duplicate reused | 3 / 2 / 2 / 6 |
| 33 | conflicting-duplicate | behavior | 6,013 | `42dc1787a0006fba1b03fead6e2b1dec802f8cd36ba901cb6403fc1a2f4629fd` | rejected / idempotency conflict | 2 / 1 / 1 / 5 |

“Invalid history” in this table is the exact public code
`GE_CYCLE_INVALID_HISTORY`. “Idempotency conflict” is the exact public code
`GE_PATCH_IDEMPOTENCY_CONFLICT`.

## Shared-worktree verification

The shared development tree passed all of the following after implementation:

- TypeScript workspace tests: 786 tests total;
  - core: 166;
  - persistence: 27;
  - primitives: 147;
  - runtime: 191;
  - patterns: 93;
  - MCP server: 15; and
  - CLI: 147;
- Python: 1,106 tests and two subtests;
- focused Python GraphPatch runtime: 23 tests;
- Ruff: all changed runtime/tests/runner paths passed;
- Mypy: 35 source files passed in the invoked strict target;
- complete TypeScript build, typecheck, and lint workspaces passed;
- fixture validation: 62 JSON fixtures, 27 case manifests, 54 H05A attacks,
  24 H05B cases, and 34 H05C cases passed in the shared tree;
- documentation links: 266 local links passed in the shared tree;
- release task map: 178/178 leaves, 175 blocking, three non-blocking, 107
  registry tasks, and an acyclic dependency graph;
- evidence closure: audit-only mode passed and 102 tests passed;
- npm package contents: seven manifests/tarballs passed;
- packed npm install: seven `0.1.0-alpha.1` tarballs installed and bins passed;
- Python artifacts: a 41-entry wheel and 42-entry sdist built, installed, and
  passed entry-point, YAML authoring, `validate`, and `doctor` smoke tests; and
- production dependency audit: no known vulnerability at the moderate
  threshold.

The complete shared cross-language conformance run passed:

- 14 graph fixtures;
- 24 RFC number vectors, 13 portable values, 15 boundary rejections, and
  10,000 seeded finite bit patterns;
- runtime ready queue, invalid output, cancellation, barriers, routing,
  persistence, durable recovery, terminal history, and bounded pipeline;
- 54 H05A hostile shape attacks;
- 24 H05B semantic/behavior cases;
- all 34 H05C replay/restore cases with complete report equality;
- 132 exact native-cycle events;
- 24 activity inputs;
- 855 durable fault obligations over 171 boundaries;
- 100 lease-renew/release fault recoveries;
- 68 cancellation/timeout recoveries;
- 25 pause/resume/replay/fork interruption recoveries;
- 35 PatchAccepted visibility recoveries;
- 15 PatchAccepted checkpoint recoveries; and
- complete authoring conformance.

## Exact verification commands

The implementation and evidence workflow executed these command classes. Every
final invocation listed below exited zero:

```text
corepack pnpm --filter @graph-engineering/runtime test
uv run --project python pytest -q python/tests/test_graph_patch_runtime.py
uv run --project python ruff check python/src python/tests tools/conformance/python_graph_patch_hostile_restore_report.py
uv run --project python mypy --config-file python/pyproject.toml python/src tools/conformance/python_graph_patch_hostile_restore_report.py
corepack pnpm test:conformance
corepack pnpm test
uv run --project python pytest -q
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm check:docs
corepack pnpm validate:fixtures
corepack pnpm check:release-map
corepack pnpm check:evidence-closure
corepack pnpm check:packages
corepack pnpm check:packed-install
uv build --project python
python3 scripts/check-python-artifacts.py
corepack pnpm audit:prod
git diff --check
```

The bare `pnpm` binary was not present in this environment. The first focused
TypeScript attempt returned exit 127, after which all repository commands used
the project-standard `corepack pnpm` invocation. No candidate source changed in
response; this was a command-resolution correction.

## Detached cold-worktree verification

The immutable candidate was checked out detached at:

```text
/tmp/graph-engineering-h05c-verify.jLuZgl
```

Cold identity before cleanup was:

```text
HEAD   fb32398faa8d918a01e9e9ca87af605236f44745
tree   f584279ce330bea2a9c49a18b88f61db9dc5dbdb
parent 5c9be9489048a3a89a392b80cdd7a3864a61a469
status empty
```

After installing the exact pnpm lockfile and correctly bootstrapping the Python
development extra, the cold tree passed:

- TypeScript runtime: eight files and 191 tests;
- Python focused GraphPatch runtime: 23 tests;
- Ruff and Mypy: all invoked targets;
- fixture validation: 59 committed JSON fixtures and 24 committed case
  manifests, including 34 H05C cases;
- documentation links: 245 committed local links;
- complete cross-language conformance, including the exact H05C 34/27/7 line;
- complete native-cycle conformance with 855 durable fault obligations;
- complete authoring conformance;
- full seven-package TypeScript build;
- release map 178/178 and evidence closure 102 tests;
- Python 41-entry wheel and 42-entry sdist isolated installs;
- seven npm package content checks and seven packed-install smoke tests; and
- production dependency audit with no known vulnerability.

The lower shared-tree fixture/link counts are expected: the detached commit did
not contain unrelated untracked D4/D9/D10 fixture and documentation work.

The temporary cold worktree was removed after verification. It contained only
regenerable dependencies, build output, Python environments, and artifacts.

## Retained cold prerequisite failures

### Fresh Python environment race and missing optional development extra

The first cold attempt launched two `uv run` commands concurrently against the
same absent `python/.venv`. One process failed test collection with
`ModuleNotFoundError: graph_engineering`; the other built the project but could
not spawn `ruff`. This was a fresh-environment bootstrap race, not a source
failure.

A subsequent `uv sync --all-groups` installed dependency groups but correctly
did not install the `project.optional-dependencies.dev` extra. The package import
then worked, while Ruff remained absent. The correct explicit bootstrap was:

```text
uv sync --project python --extra dev
```

After that command, the same focused tests, Ruff, and Mypy invocations all
passed. No candidate file was changed.

### npm package content before full workspace build

The first cold `check:packages` ran after `test:conformance`, which intentionally
builds core, persistence, runtime, and primitives but not the CLI. The content
gate correctly failed because `@graph-engineering/cli` lacked generated
`dist/src/index.d.ts`.

The correct sequence was retained and rerun:

```text
corepack pnpm build
corepack pnpm check:packages
corepack pnpm check:packed-install
```

All seven package content checks and packed installs then passed. This confirms
both that the package gate fails closed on missing generated public entries and
that the exact candidate produces valid packages after its documented build
prerequisite.

## Shared-worktree exclusions

The implementation commit deliberately excluded every unrelated shared change.
At commit time the following tracked files remained unstaged:

- `codex_logs/daily/2026-07-26.md`;
- `codex_logs/task-registry.json`;
- `codex_plans/architecture/security-and-isolation.md`; and
- `codex_plans/delivery/d9-redaction-implementation-brief.md`.

Untracked D4/D9/D10 work also remained excluded, including:

- D4 trace/subgraph review evidence;
- D9 redaction review evidence;
- budget, redaction, capture, protected-value, artifact-reference, event,
  checkpoint, pricing, router, and sink-guard schemas;
- budget, redaction, and subgraph conformance fixtures/validators;
- subgraph/redaction/budget semantics documents; and
- `tools/progress-scanner/uv.lock`.

The implementation commit was formed from an explicit 13-path staging list.
No wildcard or all-worktree staging command was used.

## Security and correctness review

The candidate narrows the restore authority surface:

- stored decisions can no longer authenticate their own planner identity;
- every authority and policy hash is syntactically closed;
- inline bytes, length, digest, decoded patch, patch ID, and patch hash remain
  mutually bound;
- budgets cannot be negative, non-finite, over-committed, or unreconciled;
- unknown diagnostic and outcome codes fail closed;
- accepted diagnostics and rejected dynamic-node commits cannot be smuggled
  across outcome boundaries;
- revision bodies cannot skip, fork silently, change patch identity, or lie
  about the resulting graph;
- graph and cumulative dynamic-node limits apply before exposure;
- exact duplicate history is safe and mutation-free;
- conflicting duplicate evidence cannot overwrite the first record; and
- every isolated attack proves zero state mutation in both runtimes.

The campaign uses deterministic synthetic hashes and local declarative Graph IR.
It contains no credential, token, external endpoint, personal data, or network
side effect.

## Deliberate exclusions and remaining work

This candidate does not claim:

- arbitrary replay/fork lineage-tree reconstruction;
- missing-ancestor, sibling, or lineage-cycle closure beyond GraphPatch decision
  sequences;
- real SQLite/PostgreSQL provider behavior;
- distributed lease/fencing correctness under process contention;
- checkpoint-assisted restore equivalence;
- ordinary scheduler application of restored graph revisions;
- standardized equality of explanatory error prose;
- D9 redaction/protected support-bundle closure;
- property-based or model-checked coverage of every possible carrier mutation;
- long-duration load or performance targets;
- complete independent security review;
- stable release completion;
- completion of the full append-only master plan; or
- any guaranteed GitHub star or adoption outcome.

The highest-value follow-up is replay/fork lineage corruption coverage or the
provider-neutral `CycleStore` contract because each unlocks several downstream
D7 production rows. The master plan's existing concurrency and distributed
store requirements remain open even though H05B already covers same-process
one-winner CAS behavior.

## Final bounded conclusion

The immutable candidate proves a concrete H05C result:

- the 34-case replay/restore corpus is closed and hashed;
- four public-applier seed carriers are byte-identical across TypeScript and
  Python;
- all 27 attacks fail with exact invalid-history codes before state mutation;
- all seven restore/idempotency behaviors satisfy their exact state projection;
- TypeScript and Python reports match completely;
- three material restore-boundary gaps were repaired;
- shared and detached verification passed;
- source, npm, Python artifact, and dependency gates passed;
- prerequisite failures were retained and resolved by correct command ordering;
  and
- no unrelated shared-worktree file entered the implementation commit.

This is sufficient to accept commit
`fb32398faa8d918a01e9e9ca87af605236f44745` as the D7-H05C hostile
GraphPatch replay/restore milestone while preserving every broader project goal
as open.
