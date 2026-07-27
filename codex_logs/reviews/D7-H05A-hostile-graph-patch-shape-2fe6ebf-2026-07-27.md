# D7-H05A hostile GraphPatch shape-capture campaign evidence

Date: 2026-07-27

Milestone: D7-H05A, hostile GraphPatch portable-shape trust boundary

Disposition: accepted as an immutable, bounded implementation milestone

Candidate commit: `2fe6ebfdd7a648bf78e8cccb14ef7040ebd5d27c`

Candidate tree: `b1f01f87888d66e4e257363e805dafd08d541cb2`

Candidate parent: `791c2eb61ccc3c1c14948bb534e69f174113dd9f`

Branch: `feat/authoring-foundation`

Producer and self-reviewer: `/root`

Independent reviewer: unavailable; all three delegated-agent execution quotas
were exhausted until 2026-08-02 15:10.

## Decision

The exact candidate above is accepted as the D7-H05A implementation candidate.
It introduces a closed, generated, cross-language hostile-input campaign at the
GraphPatch portable-shape boundary.

The campaign begins from one valid patch bound to the canonical diamond graph.
It independently materializes 54 hostile inputs in native TypeScript and native
Python, then proves that every input:

- has byte-identical canonical length and SHA-256 in both runtimes;
- fails with the exact stable `GE_PATCH_INVALID` code;
- records no patch decision;
- adds no dynamic node;
- changes no graph coordinate; and
- remains byte-identical in caller-owned memory after validation.

The corpus covers eight categories. Fifty-two inputs violate the closed schema
or nested Graph IR shapes. Two remain schema-shaped but exceed mandatory runtime
capture bounds: portable nesting beyond 100 levels and a canonical patch beyond
4,194,304 UTF-8 bytes.

This is a bounded **H05A shape-capture** result. It does not close all of
D7-H05, D7, the cycle parent tasks, the 21-day plan, a stable release, or the
repository adoption objective. A separate H05B corpus is still required for
schema-valid semantic attacks such as stale base, authority expansion, budget
evasion, state conflicts, candidate-graph failure, decided-ID conflict, and
same-base CAS races.

## Why this slice was selected

The master plan explicitly defines D7-H05 as a hostile GraphPatch suite that
blocks scheduler revision integration. Before this candidate, the repository
had valuable native unit tests and 13 declarative semantic vectors, but no
single closed attack corpus with:

- unique ordered attack identities;
- a frozen canonical corpus digest;
- bounded generator descriptions;
- independent schema reconstruction;
- dual native execution;
- per-input byte and digest equality; and
- one complete report deep-equality join.

D7-H04 budget work was deliberately not selected for this lane because the
shared worktree already contained uncommitted budget schemas and fixtures owned
by another ongoing task. H05A used disjoint paths and avoided overwriting that
work.

## Immutable candidate provenance

The implementation commit was created only after targeted native tests, full
TypeScript and Python suites, strict static analysis, independent fixture
reconstruction, repository gates, isolated full conformance, artifact builds,
packed installation, and the production dependency audit passed in the shared
worktree.

The exact commit was then checked out into a detached worktree, dependencies
were installed from committed lock state, and the complete cold verification
was repeated without shared untracked files.

Git identifies the candidate as:

```text
commit 2fe6ebfdd7a648bf78e8cccb14ef7040ebd5d27c
tree   b1f01f87888d66e4e257363e805dafd08d541cb2
parent 791c2eb61ccc3c1c14948bb534e69f174113dd9f
author reacher-z <mtrxcop@gmail.com>
committer reacher-z <mtrxcop@gmail.com>
subject add hostile graph patch shape campaign
body   empty
```

The candidate contains 11 files, 1,175 insertions, and one deletion. It has no
`Co-authored-by` trailer and no additional commit-message body.

## Exact committed scope

| Path | Candidate SHA-256 | Role |
|---|---|---|
| `CHANGELOG.md` | `1a555aa0d4ed596f5d1ec31a5bc91a57bdfc750cea62704504f23c1874ffbf4d` | public H05A change record |
| `packages/runtime/README.md` | `122acbb0d446080e7c01db5dcf00ec51aef3797e5023cd58cc4285d39eb15171` | TypeScript user-facing scope and link |
| `packages/runtime/test/graph-patch.test.ts` | `d87c347828a3d006aa923e9f4cc495b2e7d1e859efc2653a9d47bd1aae4509a0` | complete TypeScript corpus test |
| `python/README.md` | `54aa3f8352f6912b8e5bdfdc976fa63a1312ef2337117da56e0c95c9e0e2bccd` | Python user-facing scope and link |
| `python/tests/test_graph_patch_runtime.py` | `abee44812ea342f459dc2c1a463db1a46c22d78992d19aa628c226c40108ce7d` | complete Python corpus test |
| `scripts/validate-fixtures.mjs` | `ec9048fa6285c7e14dae96e7313eb967091adc9ee56b6c5adb48c880c8cc2a93` | independent attack reconstruction and schema gate |
| `spec/conformance/graph-patch-hostile-shape.case.json` | `9ba92187c9dbca7f207856a3513fd6dc1503188e6ead0b281d61417d211d65fc` | retained 54-case contract |
| `spec/cycle-semantics.md` | `fae2b5a5ff09dcc7f376500e0f4d937b32488334d0b3ef7dbd28dd657dcee567` | normative trust-boundary and exclusion text |
| `tools/conformance/graph_patch_hostile_shape.mjs` | `5d595263c957993c79d420bd1331a1ab78d7fdbe423e4b38546c74e6de8b5b22` | native TypeScript materializer and report |
| `tools/conformance/python_graph_patch_hostile_shape_report.py` | `29cf8479bf0fa309de4629c4e9e5fa7379571680da6e865e2d7edbfbc238efc0` | native Python materializer and report |
| `tools/conformance/run.mjs` | `82c3ca0ff04cea2ff4ac00fc546750fe3ee8a8aea71fd4ac1696d59bf77a7158` | cross-language complete-report join |

The fixture file itself is 447 lines and 14,070 bytes. Its complete file digest
is the value above; the ordered `cases` array has its own canonical identity
below.

## Retained seed patch

The fixture carries one compact valid GraphPatch seed. It is not imported from
either runtime's test helper.

The seed is bound to:

- base fixture `diamond.graph.json`;
- graph revision 1;
- canonical graph hash
  `24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288`;
- revision seed hash of 64 lowercase `1` characters;
- one appended `validator` node;
- one `value` edge from the already succeeded `merge` node;
- one new named output; and
- no requested capabilities or side effects.

Both native runtimes validate that seed before mutating it into attacks. Its
canonical identity is:

```text
canonical UTF-8 bytes 591
patch SHA-256          cc642b38d12508e4fa842e89e1f0d1c73a131ff1352f60984f468d00013e9ad7
```

The independent fixture validator also checks that the seed's base graph hash
equals the repository's retained diamond graph expectation. A valid-looking
patch detached from the selected base cannot silently seed the campaign.

## Closed attack corpus

The attack product is an explicitly ordered 54-case set:

| Category | Cases | Boundary covered |
|---|---:|---|
| `root` | 3 | non-object root and unknown top-level fields |
| `protocol` | 5 | API version, kind, and patch ID type/length |
| `base` | 12 | closed coordinate, safe revision, and lowercase hashes |
| `append` | 7 | closed append envelope, collection types, and non-empty append |
| `node` | 11 | node identity, kind, schemas, config, side effects, and closed fields |
| `edge` | 9 | edge identity, endpoints, ports, mode, and closed fields |
| `output` | 5 | output names, endpoint node/port, and closed fields |
| `resource` | 2 | portable depth and canonical byte ceilings |
| **Total** | **54** | complete retained H05A shape set |

Each case contains exactly:

- a stable lowercase-hyphen identity;
- one known category;
- one layer (`schema` or `runtime-capture`);
- one closed mutation descriptor; and
- expected code `GE_PATCH_INVALID`.

The fixture validator rejects duplicate identities, unknown fields, unknown
categories, unknown mutation operations, missing descriptor fields, extra
descriptor fields, and any other expected code.

## Mutation vocabulary

The committed fixture stores compact bounded mutation descriptions rather than
expanded attack blobs. The closed operation vocabulary is:

1. `replace-root` with exactly `value`;
2. `remove` with exactly `path`;
3. `add` with exactly `path` and `value`;
4. `replace` with exactly `path` and `value`;
5. `repeat-string` with exactly `path`, one scalar `character`, and a
   nonnegative safe `length`; and
6. `nest-object` with exactly `path`, non-empty `key`, and positive safe
   `depth`.

Paths use absolute JSON Pointer syntax with `~0` and `~1` decoding. Array
indices and object keys are handled separately. This matters for attacks such
as the empty output-name key, which is represented by the trailing empty JSON
Pointer token in `/append/outputs/`.

The TypeScript and Python materializers are independent implementations. They
do not invoke each other and do not consume one runtime's expanded attack
document as the other's input.

## Schema layer: 52 attacks

The 52 `schema` cases are required to fail the independent Draft 2020-12
GraphPatch validator before native execution is considered.

Representative attacks include:

- array and null roots;
- unknown root, base, append, node, edge, and output fields;
- unsupported API version and kind;
- empty, non-string, and 257-character patch IDs;
- missing or non-object base coordinates;
- zero, negative, fractional, boolean, and non-advanceable graph revisions;
- uppercase, short, and non-string hashes;
- missing or non-object append collections;
- an empty append operation;
- missing, empty, non-string, and invalid node fields;
- scalar node-array entries;
- missing, empty, non-string, and invalid edge fields;
- scalar edge-array entries; and
- empty, incomplete, or open output endpoints.

Independent schema rejection prevents both native runners from agreeing on a
widened shape and redefining the fixture as valid.

## Runtime capture layer: two attacks

The two `runtime-capture` cases intentionally pass the structural JSON Schema.
They must then fail the stricter bounded portable capture layer.

### Portable depth attack

`config-over-portable-depth` builds 101 nested objects under the node config.
The fixture remains small because it stores `{op, path, key, depth}`. Both
runtimes expand the attack locally and reject it before a decision.

The independent validator computes actual materialized depth and proves it is
greater than 100. It also proves the expanded document still satisfies the
shape schema, isolating the intended runtime boundary.

### Canonical byte attack

`patch-over-canonical-byte-ceiling` adds a 4,194,305-character payload string.
With the surrounding patch envelope, the fully materialized canonical input is:

```text
4,194,908 UTF-8 bytes
```

That exceeds the exact 4,194,304-byte patch ceiling. The generated string is
never committed in the fixture or report. Only its small generator descriptor,
resulting byte count, and digest are retained.

The independent validator separately materializes the input, confirms that the
shape schema accepts it, and confirms that its canonical byte count exceeds the
runtime limit.

## Corpus canonical identity

The complete ordered 54-case descriptor array has:

```text
canonical UTF-8 bytes 8934
SHA-256                cd229d4e9a9559140bc8f457b2237c861ddec1b39baa537d7130e5d2d91156f4
```

The digest binds order, IDs, categories, layers, mutation descriptors, and
expected codes. Changing a length, moving one row, modifying a JSON Pointer,
adding a case, or weakening an expectation changes the digest and fails the
fixture validator plus both native campaigns.

## Native per-attack oracle

For every attack, both reports retain and compare:

- stable index;
- attack ID;
- category;
- validation layer;
- materialized canonical input byte count;
- materialized input SHA-256;
- observed public error code;
- graph-coordinate unchanged status;
- dynamic-node count;
- decision-recorded status; and
- caller-input unchanged status.

Every row must report:

```text
errorCode           GE_PATCH_INVALID
coordinateUnchanged true
dynamicNodes        0
decisionRecorded    false
callerUnchanged     true
```

The TypeScript campaign constructs a new `NativeGraphPatchApplier` per case and
calls the public prepare boundary. The Python campaign constructs a new
`GraphPatchRuntime` per case and calls its public dry-run apply boundary. A dry
run is used only to avoid requiring a durable recorder after validation; no
case reaches a returned semantic decision.

The source transition orders shape capture before candidate compilation or
decision construction. The dynamic oracle proves the externally visible part:
no decision cache entry, no coordinate transition, and no dynamic-node change.
This milestone does not claim an injectable compiler-call counter.

## Cross-language report identity

The Python and TypeScript reports are generated independently and parsed as
complete JSON objects. `tools/conformance/run.mjs` performs deep strict equality
over the full report, not merely attack count or pass status.

An independently emitted Python report from the exact cold candidate had:

```text
bytes  17661
sha256 de2594844136edd73dc490f8a302fa76804fc7c689fae33275d753eebbff09dc
```

The report includes the complete 54-outcome vector but does not embed expanded
multi-megabyte input strings. The full cold conformance runner built the native
TypeScript report and accepted exact parsed equality.

## Independent fixture reconstruction

The repository fixture validator does not import either native materializer or
GraphPatch applier. It independently:

1. resolves the selected base graph safely inside the conformance root;
2. validates the seed against `graph-patch.schema.json`;
3. binds the seed to the retained diamond graph hash;
4. validates the closed attack-record shape;
5. validates the closed mutation-operation shape;
6. reconstructs all 54 attacks;
7. requires all 52 schema-layer cases to fail AJV;
8. requires both runtime-layer cases to pass AJV;
9. computes real expanded byte count or portable depth for runtime cases;
10. verifies unique IDs and exact category counts;
11. verifies the 52/2 layer split;
12. reconstructs the 8,934 corpus bytes;
13. verifies the exact corpus digest; and
14. verifies the complete nine-item required-assertion inventory.

This creates three separate failure detectors: independent schema/materializer,
native TypeScript, and native Python.

## Public tests

The TypeScript runtime suite imports the campaign and executes all 54 cases
through the source runtime. It freezes the attack count, corpus bytes, corpus
digest, error code, coordinate, dynamic-node count, decision status, and caller
detachment flags.

The Python graph-patch suite launches the native report with the same
environment interpreter, parses it, and freezes the equivalent complete
invariants. Running the script as a subprocess prevents test-path import tricks
from becoming part of the public package API.

Targeted results were:

```text
TypeScript runtime suite  189 tests passed
Python graph-patch suite  14 tests passed
```

The campaign also runs once inside the repository-wide cross-language join.

## Retained design corrections

The initial local attack design contained two invalid assumptions. They were
found by executing the native Python campaign before integration and were
corrected in the retained fixture:

1. removing `sideEffects` is valid under the existing NodeSpec default, so
   `node-missing-side-effects` was replaced with an explicit invalid enum value;
2. removing edge `mode` is valid because it defaults to `value`, so
   `edge-missing-mode` was replaced with a non-string mode attack.

The corpus digest was recomputed after each correction. No assertion was
weakened to make a valid document look hostile.

The first Python unit integration also attempted to import `tools` as a package
from the Python project test root. That path is intentionally not a public
package. The test was corrected to execute the report with the active Python
interpreter and parse stdout. The production package was not widened to expose
test tooling.

## Documentation contract

The normative cycle semantics now define:

- the exact fixture link;
- the 54-case and eight-category scope;
- the 52 schema versus two runtime split;
- the exact corpus byte count and digest;
- the 100-level and 4 MiB boundaries;
- dual native materialization and complete report comparison;
- no-decision/no-mutation/caller-detachment guarantees; and
- explicit H05B semantic exclusions.

The TypeScript and Python READMEs link users to the retained fixture and state
the same bounded claim. The changelog records the new campaign without claiming
complete D7-H05 closure.

## Shared-worktree verification

The completed implementation passed these shared-worktree gates:

| Gate | Result |
|---|---|
| TypeScript build | all seven public workspace packages passed |
| TypeScript lint and typecheck | all seven public workspace packages passed |
| TypeScript tests | core 166, persistence 27, primitives 147, MCP server 15, patterns 93, runtime 189, CLI 147; **784 total** |
| Python tests | **1,097 passed plus 2 subtests** |
| Python Ruff and Mypy | passed across 40 package/report source files |
| targeted GraphPatch tests | TypeScript runtime 189; Python graph-patch 14 |
| fixture validation | shared dirty worktree 60 JSON, 25 case manifests, all 54 hostile attacks |
| documentation links | shared dirty worktree 261 links passed |
| cross-language conformance | all existing families and the 54-case complete report passed |
| release task map | 178/178 release leaves and 40 validator tests passed |
| evidence closure | audit-only mode and 102 hostile subtests passed |
| npm contents | all seven manifests and dry-run tarballs passed |
| packed npm install | all seven tarballs installed and bins passed smoke tests |
| Python artifacts | wheel 41 entries and sdist 42 entries; both isolated installs passed |
| production dependency audit | no known vulnerabilities at the moderate threshold |
| whitespace audit | exact implementation paths passed `git diff --check` |

The shared fixture and documentation totals include unrelated uncommitted
D4/D9/D10 files. They are not immutable candidate evidence; the detached totals
below are authoritative.

## Retained high-contention conformance failure

The first shared full-conformance invocation was intentionally launched at the
same time as the complete TypeScript suite, complete Python suite, strict static
checks, and repository meta gates.

It failed inside the pre-existing Python lease fault campaign at:

```text
tools/conformance/python_cycle_report.py
_lease_fault_campaign
assert finder_calls == 1
```

The new H05A campaign was not reached in that invocation. No H05A source shared
that state. The failure occurred under high CPU contention while several fixed
deadline/fake-clock campaign processes ran concurrently.

This failure was not discarded as a pass. It establishes that the complete
conformance command is not accepted as a load/soak-safe concurrent test. After
all competing jobs ended, the full shared conformance command was rerun alone
and passed every stage, including H05A. The clean detached conformance was also
run alone and passed.

The bounded acceptance conclusion is therefore deterministic isolated
conformance, not high-contention conformance stability. Timer/load hardening
remains open performance and chaos work.

## Clean detached verification

Detached worktree:
`/tmp/graph-engineering-h05a-verify.AXxSSd`

The worktree was created at the full candidate object ID without attaching the
feature branch. Dependencies were installed from committed lock state:

```text
corepack pnpm install --frozen-lockfile
uv sync --project python --extra dev --frozen
```

The cold verification sequence included:

1. `corepack pnpm build`;
2. `corepack pnpm test`;
3. `corepack pnpm lint`;
4. `corepack pnpm typecheck`;
5. `python/.venv/bin/python -m pytest -q`;
6. Ruff across Python source, tests, and six cycle/GraphPatch reporters;
7. Mypy across Python source and the six reporters;
8. `node scripts/validate-fixtures.mjs`;
9. `node scripts/check-doc-links.mjs`;
10. `corepack pnpm check:release-map`;
11. `corepack pnpm check:evidence-closure`;
12. isolated `node tools/conformance/run.mjs`;
13. independent H05A Python report emission and hashing;
14. `corepack pnpm check:packages`;
15. `corepack pnpm check:packed-install`;
16. `uv build --project python`;
17. `python/.venv/bin/python scripts/check-python-artifacts.py`;
18. `corepack pnpm audit:prod`; and
19. clean status, whitespace, exact commit, exact tree, and file hash checks.

### Exact cold results

- all seven TypeScript builds, lint jobs, and type checks passed;
- all **784 TypeScript tests** passed;
- all **1,097 Python tests plus two subtests** passed in 68.35 seconds;
- Ruff passed and Mypy found no issue in **40** source/report files;
- **57 committed JSON fixtures** and **22 committed case manifests** passed;
- 11 referenced YAML fixtures passed;
- one graph hash and one checkpoint hash passed;
- 14 Durable JSON vectors and three compiled identities passed;
- nine GraphPatch schema cases passed;
- 13 closed GraphPatch semantic vectors passed;
- all **54 hostile GraphPatch shape attacks** passed independent reconstruction;
- all six D7 controller/revision/event/checkpoint schemas passed;
- all 16 chained event goldens passed;
- all 855 retained durable fault obligations passed fixture reconstruction;
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
- **240 committed local Markdown links** passed;
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
- **54 hostile GraphPatch attacks across eight categories passed complete
  native report equality**;
- native-cycle conformance passed 132 exact baseline events and 24 activity
  inputs;
- all 855 structural obligations across 171 boundaries passed;
- all 100 executable lease-renew/release recoveries passed;
- all 68 exact activity cancellation/timeout recoveries passed;
- all 25 exact pause/resume/replay/fork interruption recoveries passed;
- all 35 exact PatchAccepted visibility recoveries passed;
- all 15 exact PatchAccepted checkpoint recoveries passed;
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
- the independent H05A report was 17,661 bytes with the expected digest;
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
HEAD 2fe6ebfdd7a648bf78e8cccb14ef7040ebd5d27c
tree b1f01f87888d66e4e257363e805dafd08d541cb2
```

No candidate source, fixture, test, documentation, or lock file was changed to
obtain a passing cold result. The cold run produced only ignored build
artifacts.

## Artifact and supply-chain verification

The npm content gate inspected all seven public manifests and dry-run tarballs.
The packed-install gate installed all seven generated tarballs into an isolated
consumer, rewrote workspace dependencies to packed versions, and smoke-tested
installed command bins.

The Python gate built the candidate wheel and source distribution. It inspected
41 wheel entries and 42 sdist entries, installed each in a fresh environment,
and exercised console entry points, shared YAML authoring, `validate`, and
`doctor`.

The production dependency audit reported no known vulnerability at the
configured moderate threshold. These checks prove candidate packaging
integrity; they are not a registry-publication or future provenance claim.

## Shared-worktree isolation

The primary worktree contained preserved, unrelated D4/D9/D10 planning,
registry, review, schema, fixture, and scanner files. This milestone did not
stage, rewrite, delete, or claim them.

The implementation commit was assembled from the exact 11-path allowlist in
this record. The evidence commit is limited to this review file. The clean
detached verification proves H05A does not depend on the unrelated files.

The existing master plan was not edited or rewritten. D7-H05 already exists in
the append-only plan and this milestone executes one bounded part of it.

## Review limitations

All three configured delegated agents were unavailable because their execution
quotas were exhausted until 2026-08-02 15:10. This milestone therefore has
producer self-review, three independent deterministic oracle implementations,
and clean candidate reproduction, but no new independent agent or human
acceptance.

A future independent reviewer should:

- regenerate all 54 inputs from the fixture without either campaign helper;
- challenge JSON Pointer empty-token and escaping behavior;
- mutate operation descriptors and verify fail-closed fixture validation;
- test exact depth 100 versus 101;
- test exact 4,194,304 bytes versus one byte over;
- inject hostile getters, proxies, sparse arrays, cycles, symbols, and class
  instances at the programmatic boundary;
- instrument candidate-compiler and recorder call counts;
- compare exact errors on Node 20/22 and Python 3.11/3.12/3.13; and
- reproduce the exact candidate from a clean clone.

## Explicit exclusions and H05B next tranche

H05A excludes schema-valid semantic attacks, including:

- stale or foreign base coordinates;
- duplicate IDs against the base and within one append;
- incoming edges to existing nodes;
- edges from unsucceeded existing nodes;
- unsupported but schema-valid edge modes;
- capability expansion and grant laundering;
- attempt, cost, dynamic-node, node, edge, output, depth, and fan-out evasion;
- ordinary cycles and unreachable candidate nodes;
- output-schema and typed-port incompatibility;
- decided-ID exact retry and changed-byte conflict;
- accepted and rejected idempotency after policy/authority change;
- dry-run cache or ID reservation leaks;
- same-base concurrent CAS winner/loser behavior;
- forged prepared applications;
- corrupted durable accepted/rejected decision restore;
- planner output mutation after capture;
- process-level interruption during patch decision recording;
- distributed store and lease races;
- performance, soak, and chaos guarantees; and
- independent release acceptance.

Some of these behaviors already have useful native unit coverage and 13 shared
semantic vectors. H05B must turn them into one closed concrete corpus with
explicit context generators, expected phase/path/code, complete decision and
budget bytes, graph-coordinate/state oracles, idempotent replay, concurrent CAS
outcomes, independent reconstruction, and dual native report equality.

H05B should preserve the same evidence discipline:

1. freeze a bounded ordered fixture and digest;
2. generate concrete contexts and patches independently;
3. execute real TypeScript and Python appliers;
4. compare complete accepted/rejected/error projections;
5. prove no authority, budget, state, or ID escape;
6. run complete shared and clean-candidate verification; and
7. retain explicit exclusions rather than claiming full D7-H05 early.

## Milestone conclusion

D7-H05A is accepted for immutable candidate
`2fe6ebfdd7a648bf78e8cccb14ef7040ebd5d27c`.

The bounded result is strong and reproducible: 54 generated hostile shapes,
eight categories, 52 independent schema rejections, two independent runtime
capture-bound violations, exact corpus identity, exact per-input byte/hash
agreement, stable `GE_PATCH_INVALID`, zero decisions, zero graph mutation,
caller detachment, complete native report equality, and full cold repository,
conformance, package, installation, and audit gates.

The broader Graph Engineering goal remains active. This record is one verified
H05A milestone and must not be read as completion of H05B, D7, the master plan,
stable v1, or the 5K/6K organic-star objective.
