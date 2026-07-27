# D7-H05B hostile GraphPatch semantic-decision campaign evidence

Date: 2026-07-27

Milestone: D7-H05B, schema-valid hostile GraphPatch decisions and stateful
idempotency/CAS behavior

Disposition: accepted as an immutable, bounded implementation milestone

Candidate commit: `4de268cb2fc0d8bd924f2efff1fb026e45be6f6e`

Candidate tree: `d69e3335378ad5d4910e40cbaa3b539f701d3a22`

Candidate parent: `c6b9d1392c4b46f5dd7ac692977909307218769c`

Branch: `feat/authoring-foundation`

Producer and self-reviewer: `/root`

Independent reviewer: unavailable. The three already delegated agents were
platform-quota blocked until 2026-08-02 15:10 and were not repeatedly retried.

## Acceptance decision

The exact candidate above is accepted as the D7-H05B implementation candidate.
It adds a closed cross-language GraphPatch campaign whose inputs all pass the
structural GraphPatch schema and then attack semantic decision gates, decision
identity, dry-run behavior, historical retry behavior, and same-base CAS.

The retained campaign contains:

- 24 unique ordered cases;
- 19 isolated semantic decision attacks;
- five stateful behavior cases;
- eight closed categories;
- 11 mandatory assertions;
- one frozen canonical corpus byte count and digest;
- one independent JavaScript fixture validator;
- one native TypeScript decision runner;
- one independently implemented native Python decision runner; and
- one repository conformance join that requires complete report equality.

Every isolated semantic attack is required to:

- pass the closed GraphPatch JSON Schema;
- produce its exact stable public `GE_PATCH_*` error code;
- preserve the graph coordinate;
- add no dynamic node;
- record no decision in dry-run mode;
- preserve canonical patch identity; and
- agree between TypeScript and Python on the retained decision projection.

The five behavior cases additionally require exact rejected-decision reuse,
changed-byte decided-ID conflict, historical accepted-decision reuse after the
runtime advances, real application of changed bytes after a dry-run, and one
accepted plus one recorded stale rejection for two proposals sharing a base.

This is a bounded **H05B semantic-decision** result. It closes neither the whole
21-day master plan nor every future GraphPatch chaos, distributed-store,
performance, policy-provider, or adoption objective. Diagnostic paths and
phases remain runtime-local explanatory details; the campaign freezes the
portable public error code and the durable decision data that both runtimes
already share.

## Why this slice was selected

The immediately preceding H05A milestone established the portable shape trust
boundary with 54 hostile inputs. Its evidence explicitly excluded schema-valid
attacks. The master plan requires those attacks before GraphPatch can be treated
as a reliable dynamic graph mechanism.

Before this candidate, the repository had useful unit tests and 13 declarative
semantic vectors, but it did not have one closed executable corpus that joined:

- stale graph coordinates;
- identity collisions against both the current graph and the same patch;
- execution-state edge constraints;
- unsupported edge features;
- capability escalation through every supported node declaration carrier;
- per-reservation and cumulative dynamic-node budgets;
- complete graph node, edge, output, depth, and fan-out limits;
- candidate-cycle rejection;
- rejected-decision idempotency;
- accepted historical retry ordering;
- dry-run patch-ID non-reservation; and
- same-base winner/stale-loser behavior.

The shared worktree also contains unrelated uncommitted D4/D9/D10 budget,
redaction, subgraph, security-plan, progress-scanner-lock, and review-log work.
This campaign used a precise 14-file implementation scope and did not stage or
modify those owners' files.

## Defects exposed by the campaign

The first complete native comparison did not merely confirm existing behavior.
It exposed three real parity defects and the candidate repairs all three.

### TypeScript stale-rejection commit boundary

`NativeGraphPatchApplier.prepare()` correctly constructed a
`GE_PATCH_STALE_BASE` rejection for a proposal against an old coordinate.
However, `commitPrepared()` then applied the accepted-decision CAS rule to that
already-stale rejection and threw `GE_PATCH_STALE_BASE` instead of recording the
stable rejection.

The repair distinguishes an already-decided stale rejection from an accepted
or current-snapshot-dependent application. A stale rejection changes no graph,
so it can be recorded while its requested base remains stale. Accepted
applications and all other prepared outcomes retain the strict current-base
CAS check.

The `same-base-one-winner` case now proves through the public `apply()` API that:

- the first proposal is accepted;
- the runtime advances exactly once;
- the second proposal returns a recorded stale rejection;
- both patch IDs have one decision;
- the runtime ends at graph revision 2; and
- exactly one dynamic node is committed.

### Python resource capability carrier

Python previously inspected `config.capabilities` but did not inspect
`resources.capabilities`. TypeScript inspected both carriers. A schema-valid
node could therefore request a resource capability that Python failed to
include in its authority-expansion decision.

The Python `_requested_capabilities()` implementation now inspects both
`resources` and `config`, rejects malformed capability lists with the precise
carrier path, and retains the existing prohibition on caller-provided authority
objects in config. The H05B corpus requires both capability carriers to return
`GE_PATCH_AUTHORITY_EXPANSION` without mutation.

### Python cumulative dynamic-node lineage ceiling

Python previously checked only whether the current reservation covered the
nodes in the current patch. TypeScript also enforced a cumulative runtime
lineage ceiling. Repeated individually affordable patches could therefore
exceed the intended Python runtime bound.

`GraphPatchRuntime` now accepts portable `max_dynamic_nodes` and
`initial_dynamic_nodes` bounds, exposes the accepted `dynamic_nodes` projection,
and rejects booleans, negatives, values over 100,000, or an initial count above
the maximum with `GE_PATCH_INVALID`.

The counter:

- is unchanged by dry-run;
- is unchanged by a recorder failure;
- increments only after durable recording succeeds;
- participates in every live acceptance decision;
- is reconstructed from accepted event budget evidence during restore;
- requires restored committed dynamic nodes to equal the appended node count;
- fails restored history that exceeds the configured lineage ceiling; and
- is compared to TypeScript in every retained H05B state projection.

## Immutable candidate provenance

Git identifies the implementation candidate as:

```text
commit 4de268cb2fc0d8bd924f2efff1fb026e45be6f6e
tree   d69e3335378ad5d4910e40cbaa3b539f701d3a22
parent c6b9d1392c4b46f5dd7ac692977909307218769c
author reacher-z <mtrxcop@gmail.com>
committer reacher-z <mtrxcop@gmail.com>
subject add hostile graph patch semantic campaign
body   empty
```

The candidate contains 14 files, 1,514 insertions, and 23 deletions. It has no
`Co-authored-by` trailer and no commit-message body.

## Exact committed scope

| Path | Candidate SHA-256 | Role |
|---|---|---|
| `CHANGELOG.md` | `f1578c7e2bd5db6c9c19aa61469bdb007786945179ce0e781704d97a295e4de3` | public H05B change record |
| `README.md` | `2cc1db0992312be205974e26664f11564edef3f0e9658d7cd6476a18f5b60bbe` | repository-level conformance claim |
| `packages/runtime/README.md` | `197b87608d90d621d11f9c12f16d0001b9a6eee6344988ff612ff0c269c90f99` | TypeScript user-facing H05B boundary |
| `packages/runtime/src/graph-patch.ts` | `17d7a9c01ce82e1f27c6df3f41385aa9dd25373811617083f14ee02cf5ff1be3` | stale-rejection commit repair |
| `packages/runtime/test/graph-patch.test.ts` | `ec15e964334bcd2a17b082f4130e86e558c4a887fee0cc3b3781b18ccb2551bd` | complete TypeScript campaign test |
| `python/README.md` | `889a3b0446ee860e1ec6c4fbfe2c6120302868b4ba661cb5a96df4d0750a9eb7` | Python runtime and H05B documentation |
| `python/src/graph_engineering/graph_patch.py` | `48a42773086616e745e19cccdd0d9319fa97c943a25ac7c897994bd766131491` | resource capability and dynamic lineage repair |
| `python/tests/test_graph_patch_runtime.py` | `b9022274579e6701016105118fc73f0e26b41db1305f331dd9370641dde026aa` | Python unit and retained-corpus tests |
| `scripts/validate-fixtures.mjs` | `96b034bd78d9e7f83ff17c1a4b5d4459b2f970f2b56ea5522dc606060fbe9432` | independent scenario/schema validator |
| `spec/conformance/graph-patch-hostile-semantic.case.json` | `7ef75cea13c715e0db41bab1c863d4e75b539410a245c4906b6559bb9c674063` | retained 24-case H05B contract |
| `spec/cycle-semantics.md` | `1d15b3e0b4f1ec3552b29d8683d8f974471ee77c1d4314ed67015c1812205ab1` | normative semantic-decision boundary |
| `tools/conformance/graph_patch_hostile_semantic.mjs` | `c1a88bd353ab249c2e401cf3c9b9de0d43300af45c11bd28c41a3758099c78c4` | native TypeScript scenario engine |
| `tools/conformance/python_graph_patch_hostile_semantic_report.py` | `552747a7cfad63f9719380d3ca5cffef584cbe0181d31b9d01a55efc4431ae56` | independent native Python scenario engine |
| `tools/conformance/run.mjs` | `133dfee79bd4955cd7ba0f0844d31ff8d1808db3aa195e187b40c7cd6f612114` | complete-report cross-language join |

The three new retained files have these exact sizes:

```text
fixture       61 lines   5,292 bytes
TS runner    383 lines  14,329 bytes
Python runner 547 lines 19,499 bytes
```

## Closed fixture identity

The fixture ID is:

```text
graph-patch-hostile-semantic-v1alpha1
```

The ordered 24-case descriptor array has:

```text
canonical UTF-8 bytes 3590
SHA-256                9b58924f80d5b6886652a104dc9e84c0502e939ccc02751a052970c556cabb53
```

The full formatted fixture file has SHA-256:

```text
7ef75cea13c715e0db41bab1c863d4e75b539410a245c4906b6559bb9c674063
```

The validator requires all case IDs and scenario names to be unique and equal.
This prevents a human-readable identity from silently pointing at a different
native branch.

## Category closure

| Category | Cases | Boundary |
|---|---:|---|
| `state` | 3 | stale base and existing-node execution constraints |
| `identity` | 5 | node, edge, and output identity collisions |
| `feature` | 1 | unsupported stream edge |
| `capability` | 2 | config and resource capability expansion |
| `budget` | 7 | reservation, cumulative lineage, and graph limits |
| `graph` | 1 | cycle in the complete candidate graph |
| `idempotency` | 4 | rejected/accepted retry and dry-run ID behavior |
| `concurrency` | 1 | one winner and one stale same-base decision |
| **Total** | **24** | complete retained H05B set |

The category object is canonicalized by Unicode code-point order in both native
reports. Neither runtime can omit a category or silently reorder the retained
outcomes without failing the complete report comparison.

## Nineteen isolated semantic attacks

| Case | Expected public code |
|---|---|
| `stale-base` | `GE_PATCH_STALE_BASE` |
| `duplicate-existing-node` | `GE_PATCH_DUPLICATE_ID` |
| `duplicate-new-node` | `GE_PATCH_DUPLICATE_ID` |
| `duplicate-existing-edge` | `GE_PATCH_DUPLICATE_ID` |
| `duplicate-new-edge` | `GE_PATCH_DUPLICATE_ID` |
| `duplicate-existing-output` | `GE_PATCH_DUPLICATE_ID` |
| `incoming-existing-target` | `GE_PATCH_STATE_CONFLICT` |
| `source-not-succeeded` | `GE_PATCH_STATE_CONFLICT` |
| `unsupported-stream-edge` | `GE_PATCH_UNSUPPORTED` |
| `config-capability-expansion` | `GE_PATCH_AUTHORITY_EXPANSION` |
| `resource-capability-expansion` | `GE_PATCH_AUTHORITY_EXPANSION` |
| `zero-dynamic-reservation` | `GE_PATCH_BUDGET_EXCEEDED` |
| `runtime-dynamic-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `maximum-node-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `maximum-edge-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `maximum-output-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `maximum-depth-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `maximum-fanout-limit` | `GE_PATCH_BUDGET_EXCEEDED` |
| `candidate-cycle` | `GE_PATCH_GRAPH_INVALID` |

The aggregate code counts are frozen by the generated outcomes:

```text
GE_PATCH_STALE_BASE             1
GE_PATCH_DUPLICATE_ID           5
GE_PATCH_STATE_CONFLICT         2
GE_PATCH_UNSUPPORTED            1
GE_PATCH_AUTHORITY_EXPANSION    2
GE_PATCH_BUDGET_EXCEEDED        7
GE_PATCH_GRAPH_INVALID          1
total                          19
```

All 19 generated inputs have unique patch hashes. Their canonical sizes range
from 609 through 995 UTF-8 bytes. Each native report records:

- input canonical UTF-8 byte count;
- input SHA-256;
- patch ID and patch hash;
- patch canonical byte count;
- outcome and stable error code;
- unique sorted diagnostic codes;
- requested base coordinate;
- complete requested, committed, and released budget outcome;
- resulting coordinate or null;
- authority snapshot hash;
- policy snapshot hash;
- before and after graph coordinate;
- decision count;
- dynamic-node count; and
- base graph node count.

The authority snapshot hash for the isolated decisions is:

```text
eb8a0f26dfd52ee582d5b354e7608ac87937b758028425fd7c9e8b3823f35923
```

The policy snapshot hash is 64 lowercase `8` characters. The base graph is the
canonical diamond with graph hash:

```text
24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288
```

## Five stateful behavior cases

### Exact rejected retry

The first application requests ungranted `network` capability and records one
`GE_PATCH_AUTHORITY_EXPANSION` rejection. The exact retry supplies a newly
capable authority, but the decided patch ID and bytes take precedence. Both
runtimes return the original complete decision, keep one decision, remain at
revision 1, and commit zero dynamic nodes.

### Changed decided ID

The first application records a rejected decision. A second proposal reuses the
same patch ID with different canonical output bytes. Both runtimes throw
`GE_PATCH_IDEMPOTENCY_CONFLICT`, retain the first decision, remain at revision
1, and commit zero dynamic nodes.

### Historical accepted retry

Two patches are accepted in sequence, advancing the runtime to revision 3 with
two dynamic nodes. An exact retry of the first patch is then presented against
its historical revision-1 base. Decided-ID lookup precedes current-base
rejection, so both runtimes return the exact original accepted decision without
a third record or graph mutation.

The first resulting coordinate is revision 2 and the second is revision 3. The
retry's complete normalized decision equals the first decision.

### Dry-run ID reuse

A dry-run proposal is accepted as a simulation. Immediately after the dry-run:

```text
decision count  0
graph revision  1
dynamic nodes   0
```

A different canonical patch with the same patch ID is then applied for real.
Both runtimes rerun all gates, accept it, create exactly one decision, advance
to revision 2, and commit one dynamic node. No dry-run authority or patch bytes
are cached as durable identity.

### Same-base one winner

Two distinct proposals use the same revision-1 base. Sequential public API
application models the serialized CAS decision point. The retained outcome is:

```text
accepted decisions 1
stale decisions    1
decision count     2
graph revision     2
dynamic nodes      1
```

The stale rejection consumes one attempt in the recorded budget outcome but
commits zero dynamic nodes and leaves the accepted graph revision unchanged.

## Eleven mandatory assertions

The fixture freezes exactly these assertions:

1. every generated patch passes the closed shape contract;
2. semantic rejections return the exact public error code;
3. semantic rejections leave the graph coordinate unchanged;
4. dry-run rejections record no decision and consume no ID;
5. an exact rejected retry reuses the complete recorded decision;
6. changed bytes under a decided ID fail without a second record;
7. accepted historical retry precedes current-base rejection;
8. dry-run does not reserve a patch ID or cache authority;
9. same-base applications produce one accepted revision and one stale rejection;
10. both native runtimes match patch hashes, budgets, and state projections; and
11. fixture and native scenario vocabularies are closed and hashed.

The validator compares the fixture assertion set to an independent literal set.
Deleting, renaming, duplicating, or adding an unreviewed assertion fails fixture
validation.

## Independent implementation structure

The TypeScript and Python runners do not invoke one another and do not exchange
expanded proposal documents.

Both independently implement:

- base coordinate construction;
- node and patch builders;
- authority snapshots;
- reservations and graph limits;
- all 19 semantic scenario mutations;
- all five stateful behavior sequences;
- decision normalization;
- category counting;
- fixture identity checks; and
- final report construction.

The Python runner imports the public native `GraphPatchRuntime`; the TypeScript
runner imports the public `NativeGraphPatchApplier`. The repository conformance
join parses the Python process output, invokes the TypeScript runner, and uses
deep structural equality over the complete report.

The independent fixture validator does not import either scenario runner. It
has its own patch builder and scenario materializer, closes the 24-name
vocabulary, requires each generated proposal to pass the Draft 2020-12
GraphPatch schema, verifies counts and assertion closure, and recomputes the
canonical descriptor digest.

## Portable comparison boundary

The complete native reports compare stable semantic data. They intentionally
normalize diagnostics to sorted unique public codes.

Diagnostic path and phase are not claimed as cross-language protocol fields in
H05B because the runtimes currently expose different explanatory granularity
for some equivalent failures. For example, one runtime may point to a specific
ID field while the other points to the containing append collection. This is
documented rather than hidden.

Future work may define a separately versioned portable diagnostic-path contract.
That would require its own migration and hostile corpus; H05B does not silently
freeze implementation-local wording or path layout.

## Retained native report

The cold Python report, including its final newline, has:

```text
bytes    42086
SHA-256 430d9ba0c2646822ebb0e794da9b6402d56d0dd8cac582a58ece85ecdf3dcbbe
```

The JSON document itself is 42,085 bytes before the emitter's newline. The
TypeScript report matched the parsed Python report exactly across all 24
outcomes.

## Shared-worktree verification

The implementation was first validated in the shared worktree while preserving
all unrelated changes.

| Gate | Result |
|---|---|
| targeted TypeScript runtime suite | 190 tests passed |
| targeted Python GraphPatch suite before final bound cases | 16 tests passed |
| final targeted Python GraphPatch suite | 22 tests passed |
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| complete TypeScript tests | core 166, persistence 27, primitives 147, MCP 15, patterns 93, runtime 190, CLI 147; **785 total** |
| complete Python tests before the final six bound-value parameters | **1,099 passed** |
| final-candidate Python proof | complete cold suite below, **1,105 plus two subtests** |
| Python Ruff | passed source, tests, conformance, and progress-scanner paths |
| Python Mypy | no issue in 35 source/report files |
| fixture validation | shared tree 61 JSON and 26 case manifests; H05B 24/24 |
| documentation links | shared tree 265 links passed |
| release task map | 178/178 leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| cross-language conformance | every family, including H05A 54 and H05B 24, passed |
| npm package contents | all seven manifests and tarball contents passed |
| packed npm install | seven tarballs installed and bins passed |
| Python artifacts | wheel 41 entries and sdist 42 entries passed isolated installs |
| dependency audit | no known production vulnerabilities at moderate threshold |
| whitespace audit | `git diff --check` emitted no error |

The shared fixture and link totals include unrelated untracked D4/D9/D10 files.
They are useful integration evidence but are not immutable candidate totals.
The detached totals below are authoritative for commit `4de268c`.

## Clean detached verification

Detached worktree:

```text
/tmp/graph-engineering-h05b-verify.GjZIxD
```

The worktree was created from the full candidate object ID in detached mode.
Dependencies were recreated from committed lock state:

```text
corepack pnpm install --frozen-lockfile
uv sync --project python --extra dev --frozen
```

The cold sequence executed:

1. all TypeScript builds;
2. all TypeScript type checks;
3. all TypeScript lint jobs;
4. all TypeScript tests;
5. the complete Python test suite;
6. Ruff over package source, tests, conformance tools, and progress scanner;
7. Mypy over package source and the new independent report;
8. independent fixture validation;
9. documentation link validation;
10. release-map validation and its 40 tests;
11. evidence-closure audit and its 102 hostile subtests;
12. isolated complete cross-language conformance;
13. seven npm package-content checks;
14. isolated installation of seven packed npm tarballs;
15. Python wheel and sdist construction;
16. isolated installation and smoke testing of both Python artifacts;
17. production dependency audit;
18. independent H05B report emission and hashing;
19. whitespace validation;
20. clean worktree status validation; and
21. exact commit, tree, file-size, and file-hash validation.

### Exact cold results

- all seven TypeScript build, lint, and typecheck jobs passed;
- all **785 TypeScript tests** passed;
- all **1,105 Python tests plus two subtests** passed in 69.53 seconds;
- Ruff passed all selected Python source, test, conformance, and scanner paths;
- Mypy reported no issue in **35** source/report files;
- **58 committed JSON fixtures** and **23 committed case manifests** passed;
- 11 referenced YAML fixtures passed;
- one graph hash and one checkpoint hash passed;
- 14 Durable JSON vectors and three compiled identities passed;
- nine GraphPatch schema cases and 13 earlier semantic vectors passed;
- all **54 H05A shape attacks** passed independent reconstruction;
- all **24 H05B schema-valid semantic/behavior cases** passed independent reconstruction;
- all six D7 controller/revision/event/checkpoint schemas passed;
- all 16 chained event goldens passed;
- all 855 retained durable fault obligations passed fixture validation;
- all 68 activity interruption obligations passed;
- all 25 public-operation interruption obligations passed;
- all 35 PatchAccepted visibility obligations passed;
- all 15 PatchAccepted checkpoint obligations passed;
- both valid and both hostile lease transitions passed;
- both interrupted terminal/checkpoint folds passed;
- five in-doubt singleton cases passed;
- 18 terminal in-doubt resolution cases passed;
- one global-seen convergence fold and seven hard-stop folds passed;
- all 20 hostile histories and 11 hostile checkpoint folds passed;
- all five standalone phase-event shapes passed;
- **244 committed local Markdown links** passed;
- release mapping passed for **178/178** leaves and all **40** validator tests;
- evidence closure passed audit-only mode and all **102** hostile subtests;
- compiler conformance passed 14 graph fixtures;
- canonical-number conformance passed 24 RFC vectors, 13 portable values, 15
  public-boundary rejections, and 10,000 seeded finite bit patterns;
- runtime ready-queue, invalid-output, and cancellation conformance passed;
- eight settled-barrier and 12 route-selection cases passed;
- event/checkpoint persistence and event-sourced recovery passed;
- two terminal durable-history interop cases passed in both directions;
- eight bounded-pipeline cases passed;
- H05A complete-report equality passed 54 attacks across eight categories;
- H05B complete-report equality passed 24 cases, 19 decisions, and five behaviors;
- native-cycle conformance passed 132 exact baseline events and 24 inputs;
- all 855 structural obligations across 171 boundaries passed;
- all 100 executable lease-renew/release recoveries passed;
- all 68 exact activity cancellation/timeout recoveries passed;
- all 25 exact pause/resume/replay/fork interruption recoveries passed;
- all 35 exact PatchAccepted visibility recoveries passed;
- all 15 exact PatchAccepted checkpoint recoveries passed;
- all three controller modes, two in-doubt outcomes, one authority-bound
  resolution, eight terminal results, one accepted revision, one crash/takeover,
  and eight baseline checkpoints passed;
- authoring conformance passed two four-path equivalence cases with six native
  reports, six valid-source cases, 21 builder diagnostics, 77 source failures,
  13 typed diagnostics, and ten identity mutations;
- seven npm package manifests and dry-run tarballs passed;
- seven packed npm tarballs installed at `0.1.0-alpha.1` and their bins passed;
- the Python wheel contained 41 entries and the sdist contained 42 entries;
- both Python artifacts installed in isolated Python 3.14.0 environments;
- entry points, shared YAML authoring, `validate`, and `doctor` passed;
- production audit reported no known vulnerability at the moderate threshold;
- `git diff --check` emitted no error;
- `git status --short` was empty; and
- HEAD and tree matched the candidate exactly.

The final cold identity was:

```text
HEAD 4de268cb2fc0d8bd924f2efff1fb026e45be6f6e
tree d69e3335378ad5d4910e40cbaa3b539f701d3a22
```

## Retained prerequisite failure

The first cold Python artifact-check invocation was run after npm package checks
but before `uv build --project python`. It correctly failed closed with:

```text
expected one wheel and one sdist for 0.1.0a1; found [], []
```

This was a missing build prerequisite, not a source or package-content defect.
No candidate file was changed. The correct cold sequence then executed:

```text
uv build --project python
python/.venv/bin/python scripts/check-python-artifacts.py
```

It produced exactly one wheel and one sdist and passed both isolated installs.
This failure is retained because a package gate that rejects absent artifacts is
useful fail-closed evidence and should not be rewritten as an initial pass.

## Artifact and supply-chain verification

The npm content gate verified all seven public packages and rejected private
workspace leakage. The packed-install gate rewrote workspace dependencies to
the generated `0.1.0-alpha.1` tarballs in an isolated consumer, installed all
seven, and smoke-tested their command bins.

The Python artifact gate built and inspected:

- a wheel with 41 entries; and
- an sdist with 42 entries.

Each was installed into a separate Python 3.14.0 environment. Both exposed the
expected entry points and passed shared YAML authoring, `validate`, and `doctor`
smoke tests.

The production dependency audit used the repository's moderate threshold and
reported no known vulnerability.

## Security and correctness review

The candidate narrows rather than widens authority:

- Python now recognizes an additional capability declaration carrier;
- malformed capability lists still fail closed;
- cumulative dynamic-node state cannot exceed a portable maximum;
- invalid initial counters fail before graph mutation;
- restore validates committed node counts against patch content;
- dry-runs and failed recorders cannot consume dynamic capacity;
- stale rejections can be durably identified without mutating graph state;
- accepted graph changes still require the strict current-base CAS; and
- changed bytes under any decided patch ID still fail before a second record.

The campaign does not execute arbitrary user code. Nodes are declarative Graph
IR fragments and all generated documents pass the independent shape schema
before the runtime semantic gate is evaluated.

The fixture contains no secret, credential, endpoint token, or external service
configuration. All authority and policy evidence uses deterministic synthetic
hashes.

## Deliberate exclusions and remaining work

This candidate does not claim:

- cross-language equality of explanatory diagnostic paths or prose;
- distributed database CAS correctness under real multi-process contention;
- production object-store or SQL decision recorder behavior;
- provider-specific capability-policy integration;
- wall-clock load or soak stability of the long conformance command;
- GraphPatch removal or in-place mutation, which remain prohibited by the
  append-only protocol;
- unlimited dynamic graph growth;
- scheduler stream-edge execution;
- performance benchmarks or latency targets;
- full D7 parent-task completion;
- stable release completion;
- GitHub star or adoption outcomes; or
- completion of the append-only 21-day master plan.

Useful follow-up hostile work includes recorder/CAS integration against a
durable distributed store, restored-decision mutation corpora, policy-provider
fault injection, randomized schema-valid semantic generation, high-contention
timer hardening, and explicit portable diagnostic-path versioning if the
project chooses to standardize it.

## Final bounded conclusion

The immutable candidate proves a concrete H05B outcome:

- the 24-case schema-valid semantic corpus is closed and hashed;
- all 19 isolated attacks return the intended public code without mutation;
- all five stateful behaviors satisfy the intended decision and CAS invariants;
- TypeScript and Python generate exactly equal retained reports;
- the campaign exposed and repaired three real parity defects;
- shared and detached repository verification passed;
- source and artifact supply-chain gates passed; and
- no unrelated shared-worktree file entered the implementation commit.

This is sufficient to accept commit
`4de268cb2fc0d8bd924f2efff1fb026e45be6f6e` as the D7-H05B semantic-decision
campaign milestone while preserving every broader project objective as open.
