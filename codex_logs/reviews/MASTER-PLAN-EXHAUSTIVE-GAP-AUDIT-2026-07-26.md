# Graph Engineering 21-day master-plan exhaustive gap audit

- Audit time: `2026-07-26T22:29:20Z` with immutable revalidation completed
  after that snapshot
- Independent audit lane: `/root/plan_exhaustive_gap_audit`
- Canonical plan: `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- Immutable status baseline: `d5bcc0186ea743bad5bd8a1e597dc83f54310c11`
- Baseline tree: `3a3dadf7c1b4d5490031bd7c54f954e8b82f99ee`
- Baseline parent: `105881fccab3d556b5b987e062cced9e645099b7`
- Remote feature baseline at audit start: `dd8c0f7a159a717fc4cd75a5c9b3d90451433a93`
- Remote `main`: `d242b65e6f5b8e77ab2ed5c4d09ea518d4af0d52`
- Published source-alpha tag observed from the remote:
  `v0.1.0-alpha.1` at `f5d7eacd4682612f6d4e2d65806e6811d7be0cbf`
- Verdict: **the master plan is not complete; neither stable v1 nor a complete
  RC is authorized**

## 1. Executive result

The repository has a credible, well-tested alpha foundation, but it has not
implemented the full Graph Engineering product promised by the master plan.
The immutable registry contains 107 tasks: 40 `completed`, 3 `in_progress`, and
64 `planned`. The completed value is a scoped task-history state, not a release
decision. The fail-closed candidate overlay contains no candidate and assigns
exactly `0/93` release-candidate weight; historical status contributes zero.

All 178 canonical release leaves remain `Open`. Of those, 175 are mandatory
blocking leaves. Only the three organic outcome observations `REL-GR03`,
`REL-GR04`, and `REL-GR05` are non-blocking. The repository therefore has no
evidence basis for stable v1, a complete RC, package publication, production
readiness, or master-plan completion.

Two counts must never be conflated:

| Counter | Immutable/live result | Meaning |
|---|---:|---|
| Progress-scanner task-evidence gates | `10/77` | Ten registry tasks currently satisfy the scanner's task-level evidence rule. This is a liveness/evidence-migration count. |
| Release-candidate evidence weight | `0/93` | No immutable release candidate is recorded; none of the 93 required release ancestors has candidate weight. |
| Release checklist | `0/178 Green` | Every checklist leaf remains Open; 175 are mandatory. |

The strongest implemented slices are:

1. strict cross-language Graph IR source authoring, canonical serialization,
   typed ports, revision-1 identity, and initial native CLIs at immutable commit
   `dd8c0f7`;
2. deterministic native DAG schedulers and local event/checkpoint stores;
3. immutable-local-DAG event-sourced start/resume at `854b2e3`;
4. standalone bounded native pipelines at `3df201d`; and
5. fail-closed release-map and candidate-evidence controls at `105881f`, with
   immutable status binding at `d5bcc018`.

Those slices do not implement dynamic cycle execution, GraphPatch application,
complete durable redaction, leases/replay/fork/approvals, budgets/model routing,
verifier panels, isolation, provider adapters, production stores, Explorer,
all ten complete patterns, the executable course, trusted publishing, external
usability, RC, or stable release.

## 2. Scope and method

This audit read the complete canonical sources rather than relying on scanner
summaries or task titles:

| Source | Lines at audit snapshot |
|---|---:|
| Master plan | 368 |
| Task registry | 2,004 |
| Release-task map | 908 |
| Release checklist | 385 |
| Master-plan coverage matrix | 192 |
| Task dependency graph | 521 |
| Agent ownership map | 410 |
| **Total canonical control lines** | **4,788** |

The audit also inspected Git history and remotes, all package/source manifests,
public exports, CLI command parsers, CI, schemas, conformance fixtures, tests,
documentation, examples, prior independent reviews, release evidence, current
working-tree files, and the absence of promised top-level product directories.

Evidence was classified in four layers:

1. **Working-tree candidate:** useful but mutable and not completion evidence.
2. **Immutable scoped milestone:** code and tests bound to a commit, but only for
   the explicitly bounded task scope.
3. **Registry completion:** a task record, which still has zero candidate weight
   unless represented in a valid candidate overlay.
4. **Release acceptance:** every applicable release leaf Green against one
   immutable candidate, including external/provenance gates.

No layer was inferred from another. File presence, schema vocabulary, a static
pattern constructor, scanner health, test volume, or a historical `completed`
field was not accepted as proof of runtime behavior or release readiness.

## 3. Immutable Git and working-tree boundary

The final immutable status baseline has the following exact identity:

```text
commit=d5bcc0186ea743bad5bd8a1e597dc83f54310c11
tree=3a3dadf7c1b4d5490031bd7c54f954e8b82f99ee
parent=105881fccab3d556b5b987e062cced9e645099b7
author=reacher-z <mtrxcop@gmail.com>
committer=reacher-z <mtrxcop@gmail.com>
subject=docs: bind immutable authoring evidence
body=<empty>
```

The commit changes exactly nine status/evidence documents. It does not contain
the concurrent D7 cycle or D9 redaction contract work. At the last pre-log
working-tree snapshot, the branch was two commits ahead of the remote feature
branch and contained six modified tracked protocol/document files plus the
untracked D7/D9 schemas, fixtures, reviews, and contracts. These bytes are
active work, not immutable task evidence. In particular:

- `105881f` and `d5bcc018` had not yet been pushed at the audit snapshot;
- remote `feat/authoring-foundation` still resolved to `dd8c0f7`;
- remote `main` still resolved to `d242b65`;
- the published alpha tag predates durable recovery, pipeline, D2 authoring,
  the native Python CLI, and the release controls; and
- D7/D9 files must be reviewed, committed, revalidated, and pushed before any
  public availability claim.

## 4. Independent verification

### 4.1 Immutable `d5bcc018` revalidation

A temporary detached worktree was created from the exact commit, dependencies
were installed from the frozen lockfile, and the following gates ran against
committed bytes. The temporary worktree was clean after the checks and was
removed.

| Gate | Result |
|---|---|
| `corepack pnpm check:release-map` | Passed: `178/178`, 175 blocking, 3 non-blocking, 37 blocking producers, 94-task roll-up closure, 107 acyclic tasks, `40/40` hostile tests. |
| `corepack pnpm check:evidence-closure` | Passed: `102/102`; audit-only, 93 required ancestors, zero candidates, release weight `0/93`, historical weight `0`. |
| `corepack pnpm check:docs` | Passed: 197 commit-local Markdown links. |
| Registry status count | 40 completed, 3 in progress, 64 planned. |
| Detached `git status --short` | Empty. |

### 4.2 Current working-tree read-only checks

The mutable D7 working tree passed its current offline fixture validation:

```text
Validated 51 JSON fixtures (16 case manifests), 11 referenced YAML fixtures,
1 graph hash, 1 checkpoint hash, 14 Durable JSON vectors, 3 compiled identities,
9 graph patch schema cases, and 6 D7 controller/revision/event/checkpoint schemas
with 16 chained event goldens plus 4 standalone phase-event shapes.
```

The current working tree also passed 228 Markdown links and `git diff --check`.
This is D7 contract-shape evidence only. The validator does not execute native
TypeScript/Python cycle controllers, and at this audit snapshot it did not
integrate the new D9 redaction corpus.

### 4.3 Observed fail-closed integration race

During a concurrent registry update, one audit invocation of
`corepack pnpm check:release-map` returned `39/40`: the task had fresh passing
evidence while still momentarily `in_progress`, and the hostile test correctly
rejected that inconsistent state. After the integration owner stabilized and
isolated the status patch, the live rerun and detached `d5bcc018` rerun both
returned `40/40`.

This is evidence that the control fails closed, but also evidence of a shared
file write race. Root-owned registry/map/checklist changes must be serialized
or merged from isolated worktrees; a final green rerun must follow every such
integration window.

## 5. Twenty-one-day delivery matrix

| Day | Audit state | Immutable evidence | Missing master-plan exit evidence | Primary registry controls |
|---:|---|---|---|---|
| 1 | Partial | Public source alpha, MIT/governance/CI, initial IR/events, scanner and plans | Complete reviewed document set, final governance/distribution evidence, candidate-bound historical revalidation | `D1-*`, `CTRL-PLAN-COVERAGE-001`, `CTRL-EVIDENCE-002`, `CTRL-DOCS-073` |
| 2 | Scoped milestone Green; full day Partial | `dd8c0f7`: strict JSON/bounded YAML, TS/Python builders, canonical hashes, typed ports, revision-1 identity | GraphPatch revision 2+, general schema assignability, runtime value validation, reducers, subgraphs, stream/artifact execution, later policy/budget enforcement | `D2-BUILDERS-YAML-020`, downstream D4/D7/D10/D12 |
| 3 | Scoped initial CLI Green; full day Partial | TS and Python `init/validate/compile/plan/doctor`, both Python console aliases, TS visualize | Complete runtime/provider/operations/cost/score/badge/worktree/artifact/plugin/MCP command matrix and installed OS parity | `D3-PY-CLI-021`, `D9-OPS-CONTROL-085`, `D13-DX-051`, `D14-API-FREEZE-050`, `D18-COMPAT-BENCH-064` |
| 4 | Partial | Native deterministic DAG schedulers and chain/diamond behavior | Trace contract/viewer, nested subgraphs/namespaces, reducers, executable stream/artifact edges | `D4-TRACE-SUBGRAPH-022`, `D15-EXPLORER-060` |
| 5 | Partial; standalone pipeline Green | `3df201d` bounded native pipelines; pure settled barriers and route evaluators | Scheduler-integrated deadline/quorum barriers, conditional edges, durable route replay, stream-edge lowering | `D7-PIPELINE-CONFORMANCE-013`, `D6-ROUTER-BARRIER-023` |
| 6 | Partial | Structured scheduler/pipeline failures, retry, timeout and cancellation | Complete terminal-state machine, runtime quorum/abstention/unknown/human gates, failure-injection join | `D6-ROUTER-BARRIER-023`, `D11-VERIFY-*` |
| 7 | Open runtime; contract candidate only | Published source-alpha tag and static acyclic loop constructor; mutable D7 schemas/fixtures | Native TS and Python controllers/patch appliers, global seen convergence, every hard stop, durable recovery and cross-language join | `D7-CYCLE-SPEC-024`, `D7-TS-CYCLES-025`, `D7-PY-CYCLES-026`, `D7-CYCLE-CONFORMANCE-027` |
| 8 | Partial runtime base; acceptance Open | Existing retry/timeout/cancel and pipeline cleanup tests | Non-cooperative chaos, leak/deadlock campaign, durable operational CLI, joined acceptance | `D8-RUNTIME-CHAOS-084`, `D9-OPS-CONTROL-085`, `D8-CHAOS-OPS-030` |
| 9 | Partial local-DAG durability; critical security Open | `854b2e3` local event-sourced start/resume, CAS stores, file checkpoints, terminal idempotence | Truthful sink-before-write redaction, approval authority, leases, SQLite/artifacts, replay/fork, dual resume, production stores | `D9-REDACTION-*`, `D9-APPROVAL-077`, `D9-DURABLE-EXT-*` |
| 10 | Open | Narrow attempt/concurrency limits only | Token/money/time/node/model budgets, atomic reservations, pricing identity, model router, cost CLI/UI, resume-safe hard stops | `D10-*` |
| 11 | Open | Static verified-fanout graph shape only | Reflection, refutation, diverse lenses, citations, judges, versioned rubrics, votes, abstention/unknown/human gates | `D11-*` |
| 12 | Open | Honest documentation of ambient authority only | Deny-by-default capabilities, approvals, worktree/process/container providers, merge gate and red-team escapes | `D12-*` |
| 13 | Open | Deterministic local executor/mock-like tests only | Native official provider/tool adapters, streaming/tools/usage/rate/circuit/fallback/cancel conformance, Alpha 2, score/badge/picker | `D13-*` |
| 14 | Open | Read-only validation/planning MCP; four TS constructors | Public API freeze, plugin SDK, policy-gated MCP mutation, ten skeletons, canonical unscoped npm distribution | `D14-*` |
| 15 | Open | In-memory/JSONL events and local file checkpoints | SQLite/local artifacts default, PostgreSQL/S3, LockManager/workers, OTel, React Explorer, time travel and benchmark baselines | `D15-*` |
| 16 | Partial source security; runtime security Open | CodeQL/dependency review/Dependabot and source-package audits | Complete D9 security join, enforceable policy, privacy/retention, threat model, fuzz, secret/license/SBOM/escape evidence, zero blockers | `D16-*`, `D9-REDACTION-CONFORMANCE-089` |
| 17 | Open/External | Public issues and Discussions recruitment surface | Immutable Beta, defect burn-down, five consented reports, 80% first-run within five minutes, external retest | `D17-BETA-063`, `D17-USABILITY-076` |
| 18 | Open | Linux Node 20/22 and Python 3.11/3.12/3.13 CI declarations | macOS/Windows, full positive/negative parity, 100-way/1,000-node, 100 randomized faults, education and support readiness | `D18-*`, `CTRL-ACCEPTANCE-070` |
| 19 | Open | Local npm tarball and wheel/sdist smoke for alpha slices | Full installed artifact/upgrade/migration matrix, frozen references, zero P0/P1, signed `1.0.0-rc.1` | `D19-RC-065` |
| 20 | Open/External | Protected source checks only | Trusted npm/PyPI identity, unscoped npm package, SBOM, checksums, attestations, full secret scan and non-publishing rehearsal | `D20-PROVENANCE-066` |
| 21 | Open/External | Structural release map and empty-overlay control are complete | Candidate evidence for 93 ancestors, every mandatory leaf Green, final roll-up, complete RC/stable artifacts, site/launch/support and authorized publication | `CTRL-RELEASE-ROLLUP-086`, `D21-RELEASE-067`, `CTRL-GROWTH-072` |

## 6. Complete 107-task ledger

This ledger contains one row for every task in the immutable registry. The
registry status and the independent audit disposition are intentionally
separate.

<!-- TASK_LEDGER_START -->

### 6.1 Registry-completed tasks — 40

| Task | Registry | Immutable evidence class | Independent disposition |
|---|---|---|---|
| `D1-SPEC-001` | completed | Source-alpha foundation | Accept only initial IR/fixture scope; pre-policy and zero candidate weight. |
| `D1-TS-001` | completed | Source-alpha foundation | Accept initial TS compiler/scheduler scope; later node kinds and release parity remain open. |
| `D1-PY-001` | completed | Source-alpha foundation | Accept initial native Python compiler/scheduler scope; later surface remains open. |
| `D1-PLATFORM-001` | completed | Source-alpha foundation | Accept scanner/initial CLI/Quickstart scope; not complete platform evidence. |
| `D1-BRAND-001` | completed | Narrowed and bound at `d5bcc018` | Correctly narrowed to public source remote and metadata identity; registry publishing remains D20. |
| `D1-DOCS-001` | completed | Source-alpha docs | Concepts/failure/security docs exist; final course/operations/API/security docs remain open. |
| `D2-TS-PERSIST-001` | completed | Source-alpha foundation | Accept local TS event/checkpoint store slice; no production store or full storage conformance. |
| `D2-PY-PERSIST-001` | completed | Source-alpha foundation | Accept local Python event/checkpoint store slice; no production store or full storage conformance. |
| `D2-MCP-001` | completed | Source-alpha foundation | Accept read-only validation/planning MCP only; no runtime mutation/plugin evidence. |
| `D3-CLI-002` | completed | Source-alpha foundation | Accept initial TS compile/doctor envelope only; complete CLI matrix remains open. |
| `D3-PY-RUNTIME-002` | completed | Source-alpha foundation | Accept initial scheduler cancellation parity; chaos/non-cooperative/operations remain open. |
| `D3-TS-RUNTIME-002` | completed | Source-alpha foundation | Accept initial structured scheduler failure parity; broader runtime remains open. |
| `D4-CLI-INIT-003` | completed | Source-alpha foundation | Accept bounded safe init behavior only. |
| `D3-PY-JSON-003` | completed | Source-alpha foundation | Accept detached runtime JSON snapshot behavior only. |
| `D4-TS-PRIMITIVES-003` | completed | Source-alpha foundation | Accept pure settled barrier evaluator, not scheduler-integrated barriers. |
| `D4-PATTERNS-004` | completed | Source-alpha foundation | Accept four TS constructors only; no complete pattern bundle is Green. |
| `D4-PY-PRIMITIVES-004` | completed | Source-alpha foundation | Accept pure Python barrier parity, not durable waiting. |
| `D5-TS-ROUTER-005` | completed | Source-alpha foundation | Accept pure route selection, not conditional scheduler execution/replay. |
| `D5-CLI-VISUALIZE-005` | completed | Source-alpha foundation | Accept static Mermaid/DOT output, not Explorer/OTel/live traces. |
| `D5-PY-ROUTER-005` | completed | Source-alpha foundation | Accept pure Python route selection, not durable runtime routing. |
| `D5-PATTERN-EXAMPLES-006` | completed | Source-alpha foundation | Accept two provider-free examples only; PB bundle gate remains Open. |
| `D5-RELEASE-AUDIT-006` | completed | Historical alpha audit | Useful audit only; not final TS package/release acceptance. |
| `D5-PY-RELEASE-AUDIT-006` | completed | Historical alpha audit | Useful audit only; not final PyPI/provenance acceptance. |
| `D5-DX-RELEASE-AUDIT-007` | completed | Historical alpha audit | Useful onboarding audit only; external usability remains Open. |
| `D5-SECURITY-RELEASE-008` | completed | Historical source-alpha audit | Title can overread as final-v1 security; accept only source-alpha audit boundary. |
| `D5-LAUNCH-READINESS-009` | completed | Historical benchmark/audit | Accept research/plan output only; adoption and launch execution remain Open. |
| `D6-DURABLE-SPEC-010` | completed | `854b2e3` durable slice | Accept immutable-local-DAG recovery contract only. |
| `D6-TS-DURABLE-010` | completed | `854b2e3` durable slice | Accept TS start/resume for immutable local DAG; redaction/extensions excluded. |
| `D6-PY-DURABLE-010` | completed | `854b2e3` durable slice | Accept Python start/resume for immutable local DAG; redaction/extensions excluded. |
| `D6-DURABLE-CONFORMANCE-011` | completed | `854b2e3`/`d4de336` | Accept scoped crash/resume interop; not full D9 recovery acceptance. |
| `D7-PIPELINE-SPEC-012` | completed | `3df201d` | Accept standalone bounded-pipeline contract. |
| `D7-TS-PIPELINE-012` | completed | `3df201d` | Accept standalone TS pipeline; Graph IR stream lowering/durable items excluded. |
| `D7-PY-PIPELINE-012` | completed | `3df201d` | Accept standalone Python pipeline; Graph IR stream lowering/durable items excluded. |
| `D7-PIPELINE-CONFORMANCE-013` | completed | `3df201d`/`582b78b` | Accept standalone cross-language pipeline scope; release leaf still lacks candidate weight. |
| `CTRL-PLAN-COVERAGE-001` | completed | Delivery-control documents | Accept coverage-control structure; maintaining it is ongoing and does not close plan rows. |
| `CTRL-EVIDENCE-002` | completed | Scanner evidence control | Accept task-evidence scanner behavior; scanner counts are not release weights. |
| `D2-BUILDERS-YAML-020` | completed | `dd8c0f7`, tree `b8ad7ce`, independent review | Accept six bounded source-authoring requirements; explicit downstream exclusions remain Open. |
| `D3-PY-CLI-021` | completed | `dd8c0f7`, wheel/sdist smoke | Accept initial Python CLI/aliases/exits; full installed command matrix remains Open. |
| `CTRL-RELEASE-MAP-074` | completed | `105881f`, bound by `d5bcc018` | Accept mapping control: 178 exact Open leaves and 40 hostile tests; closes no leaf. |
| `CTRL-EVIDENCE-BACKFILL-075` | completed | `105881f`, bound by `d5bcc018` | Accept fail-closed protocol implementation; canonical overlay remains empty at `0/93`. |

### 6.2 In-progress tasks — 3

| Task | Registry | Current evidence | Required closure |
|---|---|---|---|
| `D7-CYCLE-SPEC-024` | in_progress | Mutable cycle/GraphPatch/controller/revision/event/checkpoint schemas, fixtures and prose; offline schema/fold validation passes | Resolve final independent contract findings and the spec-versus-native completion boundary; immutable commit/review. Native execution remains under 025/026/027. |
| `D9-REDACTION-039` | in_progress | Mutable normative semantics plus v1alpha2 capture/protected-value/event/checkpoint schemas and redaction corpus | Freeze and independently review the full contract, then implement 087/088 and byte-level security join 089. Current native v1alpha1 wire signal remains unsafe. |
| `CTRL-DOCS-073` | in_progress | Planning/architecture/growth documents and passing link checks | Cannot close until API, Explorer, performance, security, all patterns, course, operations and bilingual assets exist and claims match one candidate. |

### 6.3 Planned tasks — 64

| Task | Registry | Missing deliverable / acceptance boundary |
|---|---|---|
| `D4-TRACE-SUBGRAPH-022` | planned | Subgraph namespace/checkpoint scopes, reducers, executable stream/artifact edges, trace contract and native parity. |
| `D6-ROUTER-BARRIER-023` | planned | Scheduler-integrated conditional routing, durable decisions, deadline/quorum barriers and missing statistics. |
| `D7-TS-CYCLES-025` | planned | Native TS bounded controller and checked GraphPatch compiler/applier. |
| `D7-PY-CYCLES-026` | planned | Independent native Python controller/patch parity. |
| `D7-CYCLE-CONFORMANCE-027` | planned | Executable cross-language convergence, counters, exits, patch, crash/resume/replay/fork join. |
| `D8-CHAOS-OPS-030` | planned | Final join of non-cooperative runtime chaos and durable operational controls. |
| `D9-DURABLE-EXT-SPEC-031` | planned | Lease, artifact, checkpoint acceleration, replay/fork, approval and route-replay contract after redaction. |
| `D9-TS-DURABLE-EXT-032` | planned | TS leases/SQLite/artifacts/replay/fork/approval implementation. |
| `D9-PY-DURABLE-EXT-033` | planned | Native Python extended durability implementation. |
| `D9-DURABLE-EXT-CONFORMANCE-034` | planned | Cross-language race, dual-resume, lineage, stale approval, corruption and route-replay join. |
| `D10-BUDGET-SPEC-035` | planned | Portable units, reservations, pricing identity, hard-limit and model-routing contract. |
| `D10-TS-BUDGET-036` | planned | TS durable budget ledger, model router and cost reporting. |
| `D10-PY-BUDGET-037` | planned | Native Python budget/model/cost parity. |
| `D10-BUDGET-CONFORMANCE-038` | planned | Every hard bound, contention, crash/resume and cost-envelope parity. |
| `D11-VERIFY-SPEC-040` | planned | Verifier/judge/citation/reflection/quorum/unknown/human-gate contract. |
| `D11-TS-VERIFY-041` | planned | TS panels, evidence, citations, judges and reflection runtime. |
| `D11-PY-VERIFY-042` | planned | Native Python verification runtime. |
| `D11-VERIFY-CONFORMANCE-043` | planned | Maker/verifier isolation, votes, abstention, unknown, citation and stale-gate parity. |
| `D12-ISOLATION-SPEC-044` | planned | Closed capability/approval/worktree/process/container/merge threat contract. |
| `D12-TS-ISOLATION-045` | planned | TS deny-by-default enforcement and isolation providers. |
| `D12-PY-ISOLATION-046` | planned | Native Python isolation/policy parity. |
| `D12-ISOLATION-REDTEAM-047` | planned | Path/symlink/process/port/container/prompt/stale-lease/merge red-team join. |
| `D13-ADAPTER-SPEC-048` | planned | Vendor-neutral provider/tool capability and conformance contract. |
| `D13-ADAPTERS-049` | planned | Final cross-language official adapter join. |
| `D13-DX-051` | planned | Complete doctor, deterministic G0-G4 score, badge, picker and top-three remediations. |
| `D14-API-FREEZE-050` | planned | Immutable public API/IR/diagnostic/export compatibility freeze. |
| `D14-MCP-PLUGINS-052` | planned | Plugin SDK/discovery and approval/policy-gated runtime MCP mutation. |
| `D14-PATTERN-SKELETONS-053` | planned | Honest YAML/JSON/TS/Python skeletons for all ten patterns. |
| `D15-STORAGE-WORKERS-054` | planned | SQLite/local artifact defaults, PostgreSQL/S3 and lease-coordinated workers. |
| `D15-EXPLORER-060` | planned | React Explorer, OTel, live topology/state/budget/critical-path/time-travel views. |
| `D15-PERFORMANCE-061` | planned | Reproducible latency/throughput/recovery/first-run baselines and 10% gate. |
| `D16-SECURITY-062` | planned | Full attack-surface preflight, fuzz/secret/license/SBOM evidence and zero unaccepted high/critical. |
| `D17-BETA-063` | planned | Immutable Beta artifact/API and repository-owned P0/P1 burn-down. |
| `D18-COMPAT-BENCH-064` | planned | Full source parity, OS/runtime matrix, coverage, scale and 100 randomized faults. |
| `D19-RC-065` | planned | Installed npm/Python/CLI/upgrade/migration/reference matrix and signed RC. |
| `D20-PROVENANCE-066` | planned | Trusted npm/PyPI identity, SBOM/checksums/attestations and final package scans. |
| `D21-RELEASE-067` | planned | Authorized stable or honestly complete RC release, site, launch and support operation. |
| `PATTERN-01-RESEARCH` | planned | Complete PB multi-source research bundle with native parity, failure and resume. |
| `PATTERN-02-CITED` | planned | Complete cited-research/citation-verification bundle. |
| `PATTERN-03-AUTH` | planned | Complete fail-closed route-auth security sweep bundle. |
| `PATTERN-04-DIFF` | planned | Complete diff router/diverse judge panel bundle with retained votes. |
| `PATTERN-05-UNTIL-DRY` | planned | Complete dynamic seen-set convergence/budget/verifier bundle. |
| `PATTERN-06-MIGRATION` | planned | Complete worktree migration/test/merge/conflict/resume bundle. |
| `PATTERN-07-CI` | planned | Complete bounded approved/idempotent CI sweeper bundle. |
| `PATTERN-08-DEPS` | planned | Complete isolated dependency-update/security/license bundle. |
| `PATTERN-09-PR` | planned | Complete durable PR babysitter/approval/MCP bundle. |
| `PATTERN-10-ECOSYSTEM` | planned | Complete scheduled bounded ecosystem scan/worker/provider bundle. |
| `CTRL-PATTERNS-071` | planned | Machine bundle checker and accepted E2E evidence for all ten patterns. |
| `CTRL-ACCEPTANCE-070` | planned | Candidate-bound proof for every invariant, mandatory scenario and quantitative threshold. |
| `CTRL-GROWTH-072` | planned | Truthful launch assets, privacy-safe metrics, experiments, community and support execution. |
| `D17-USABILITY-076` | planned | Five consented external reports, 80% under 300 seconds and independent review. |
| `D9-APPROVAL-077` | planned | Authority/revision/expiry/revoke/idempotency approval contract. |
| `D14-NPM-DIST-078` | planned | Real unscoped `graph-engineering` npm package and both binaries; no workspace refs. |
| `D16-PRIVACY-079` | planned | Default-off telemetry/capture, retention, withdrawal and gallery consent policy/evidence. |
| `D18-SUPPORT-READINESS-080` | planned | Named roster, incident/rollback/yank/support-bundle/redaction/tabletop readiness. |
| `D13-TS-ADAPTERS-081` | planned | TS model, HTTP, shell and MCP adapter package. |
| `D13-PY-ADAPTERS-082` | planned | Native Python adapter package. |
| `D18-EDUCATION-ASSETS-083` | planned | Executable 14-step course, cases, uncut demo, side-by-side and bilingual assets. |
| `D8-RUNTIME-CHAOS-084` | planned | Cross-language retry/cancel/non-cooperative leak/deadlock campaign. |
| `D9-OPS-CONTROL-085` | planned | Durable status/watch/inspect/logs/pause/resume/cancel/retry CLI parity. |
| `CTRL-RELEASE-ROLLUP-086` | planned | Fail-closed stable/RC/no-release decision over every mandatory producer. |
| `D9-TS-REDACTION-087` | planned | TS sink-before-write durable protection and bypass prevention. |
| `D9-PY-REDACTION-088` | planned | Native Python sink-before-write parity. |
| `D9-REDACTION-CONFORMANCE-089` | planned | Byte-level canaries, failures/races/migration/bypass and independent security join. |

<!-- TASK_LEDGER_END -->

## 7. Release-leaf inventory

The independently rebuilt release inventory agrees with the machine checker:

| Checklist family | Leaves | Current Green | State |
|---|---:|---:|---|
| Stable-v1 joins | 8 | 0 | Open |
| Non-negotiable invariants | 10 | 0 | Open |
| Cross-language equality | 10 | 0 | Open |
| Mandatory scenarios | 33 | 0 | Open |
| Quantitative thresholds | 11 | 0 | Open |
| OS/runtime matrix | 17 | 0 | Open |
| Packages/distribution | 13 | 0 | Open |
| Supply chain/security | 14 | 0 | Open |
| External usability | 10 | 0 | Open/External |
| Pattern bundle plus ten patterns | 11 | 0 | Open |
| Documentation/assets | 16 | 0 | Open |
| Growth/community | 7 | 0 | Open; three outcome rows non-blocking |
| Support | 8 | 0 | Open/External |
| RC fallback/no-go | 10 | 0 | Open |
| **Total** | **178** | **0** | **175 mandatory Open** |

The 178-to-task mapping is structurally and semantically controlled, but a
mapping says where evidence must eventually come from; it is not evidence that
the requirement has passed.

## 8. Completed-status audit

No currently completed task, after the `D1-BRAND-001` narrowing, was proven to
be wholly fictitious within its explicitly bounded task scope. That is not the
same as accepting all 40 for release:

- the first 30 foundation/durable tasks were completed before the explicit
  evidence cutoff and have no candidate overlay record;
- the four pipeline tasks are bound to `3df201d` but still have zero release
  weight for a future candidate;
- D2/D3 are strongly bound to `dd8c0f7` and independent review, but only for
  their listed authoring/initial-CLI scope;
- the four delivery controls prove planning/scanning/mapping/evidence
  infrastructure, not product capabilities; and
- every historical completion remains zero-weight because the canonical
  candidate array is empty.

Two legacy titles remain overclaim risks if quoted without their scope:

1. `D5-SECURITY-RELEASE-008` says “Final” but proves the source-alpha audit,
   not final-v1 runtime/package/security acceptance.
2. `D4-PATTERNS-004` says “Executable bounded graph pattern constructors” but
   its implementation is four TypeScript graph constructors, not the ten PB
   bundles or dynamic verifier/cycle execution.

They need not be reopened if documentation and release evidence preserve these
boundaries, but they must never be cited as proof of D16 security or
`CTRL-PATTERNS-071`.

## 9. P0 release blockers

### P0-01 — current durable events make a false redaction claim

The shipped native v1alpha1 implementations persist raw `draft.data` while
setting `redacted: true`:

- `packages/runtime/src/durable.ts:397-409` sets `redacted: true` and then
  `data: draft.data`;
- `python/src/graph_engineering/durable.py:217-228` does the same; and
- `python/src/graph_engineering/events.py:84` defaults `redacted` to `True`.

The mutable D9 contract is valuable, but there is no committed native
sink-before-write implementation or byte-level security join. Until 039,
087, 088 and 089 all pass, extended durability, Explorer/export/support sinks,
security preflight and release are blocked.

### P0-02 — dynamic cycles and GraphPatch are not executable

Mutable schemas and fold fixtures do not create a runtime. There is no native
TS controller/patch applier, no native Python controller/patch applier, and no
cross-language execution/recovery reporter. The existing `loopUntilDry`
constructor expands a finite acyclic graph and is explicitly not dynamic cycle
evidence. This blocks the central Graph Engineering promise, budget work,
several patterns and the mandatory cycle/patch leaves.

### P0-03 — Days 10-16 core runtime surface is largely absent

There is no budget ledger/model router, verifier/judge/reflection runtime,
capability/worktree/process/container enforcement, official provider adapter
packages, production stores/workers, OpenTelemetry stack or React Explorer.
The promised directories `apps/`, `packages/adapters`, `packages/isolation`,
`packages/plugin-sdk`, `packages/observability`, `benchmarks`, `deploy`,
`tests/security`, and `tests/chaos` were absent from the immutable baseline.

### P0-04 — all ten complete pattern bundles are missing

No pattern meets PB: YAML/JSON plus native TS/Python, deterministic fixtures and
events, mock E2E, optional provider setup, diagram, budgets, permissions,
failure/resume, tests and four launcher guides. Existing constructors/examples
are partial inputs only. All eleven pattern release rows remain Open.

### P0-05 — no release candidate exists

The canonical overlay is `candidates: []`; release weight is `0/93`; every
release leaf is Open. There is no Beta, signed RC, final roll-up, stable package
or release authorization. A registry `completed` count, total test count, tag,
or scanner score cannot substitute for this conjunctive gate.

### P0-06 — provenance and external acceptance are absent

There is no canonical unscoped npm distribution, trusted npm/PyPI provenance,
SBOM/checksum/attestation set, macOS/Windows release matrix, five consented
external reports, 80%-within-five-minutes result, acknowledged support roster,
or independently signed go/no-go. These include external-authority gates that
cannot be manufactured inside the repository.

## 10. P1 gaps and integration risks

1. **D7 dependency/acceptance deadlock.** Registry tasks 025/026 depend on
   `D7-CYCLE-SPEC-024`, while the current D7 independent review says the spec
   task must remain open until native execution/conformance exists. Either
   narrow 024 to machine-contract acceptance and place native P0-03 solely in
   025/026/027, or explicitly authorize implementations from an accepted frozen
   contract while 024 remains in progress. Do not leave a status dependency
   that prevents the work required to close itself.
2. **Shared control-file write race.** The observed temporary 39/40 result
   proves concurrent root-owned registry writes can expose an inconsistent
   intermediate state. Serialize registry/map/checklist changes, review the
   final diff, and rerun controls after quiescence.
3. **Unpushed immutable work.** At snapshot, `105881f` and `d5bcc018` existed
   only locally. Push and verify the exact remote SHA before describing these
   controls/status bindings as public.
4. **D7/D9 are mutable and mixed in one shared worktree.** Contract bytes,
   reviews and validator edits are not independently recoverable until split,
   reviewed and committed. Keep D7 and D9 manifests separate and exclude the
   unrelated progress-scanner lockfile.
5. **D9 contract corpus is not yet joined to the repository validator.** The
   current validator output names D7 schemas and fixtures but not D9; manual
   schema checks are useful author evidence, not the native/security join.
6. **Scanner liveness is attention-worthy.** The latest scan at
   `2026-07-26T22:26:10Z` reported one stale task (`D4-TRACE-SUBGRAPH-022`,
   139.1 minutes) and a warning on `D9-REDACTION-039` (116.1 minutes), even
   though there was no integration-risk classification. Artifact presence
   should be reconciled with current ownership/heartbeats.
7. **Published surfaces lag feature branches.** Remote main and the alpha tag
   do not contain durable recovery, pipeline, D2 authoring or the new controls.
   Release notes and README claims must distinguish released, remote feature,
   local immutable and mutable-working-tree capabilities.
8. **Canonical npm distribution is missing.** Current workspaces publish scoped
   `@graph-engineering/*` packages; the planned unscoped `graph-engineering`
   package and its installed `graph`/`grapheng` verification remain 078/019/020
   work.
9. **CI portability is incomplete.** CI declares Linux-only jobs for Node
   20/22 and Python 3.11/3.12/3.13. macOS/Windows, installed command matrices,
   randomized faults, scale, performance, secret/license/SBOM and live opt-in
   adapter coverage are absent.
10. **No quantitative coverage release report exists.** Raw test counts exceed
    250 in current evidence, but the required compiler/scheduler/event-store/
    policy 90% statement and 85% branch thresholds have no consolidated
    candidate-bound report.

## 11. P2 follow-ups

1. D2's independent review retains two non-blocking maintenance findings:
   same-worktree `dist`/`prepack` races and duplicate internal Python portable
   capture helpers.
2. The scanner's `10/77` denominator covers task evidence, not all 107 tasks or
   178 leaves. Dashboards and status prose should always label the denominator.
3. The mutable D9 semantics header and schema inventory may temporarily drift
   while the contract agent finishes. Update both atomically before review.
4. Generated cache/lock artifacts such as `tools/progress-scanner/uv.lock`
   should remain excluded unless deliberately reviewed as a scanner dependency.
5. Long-term benchmark and growth numbers need dated source snapshots; they
   are moving external observations, not static engineering acceptance facts.

## 12. Quantitative acceptance ledger

| Threshold | Audit result |
|---|---|
| Compiler/scheduler/event store/policy >=90% statements, >=85% branches | Open: no consolidated candidate report. |
| >=250 unit/integration cases per language | Raw counts appear met in D2 evidence; release classification/ownership remains Open. |
| Shared adapter/storage conformance | Open: official adapters and production storage matrix absent. |
| 100 randomized failures without deadlock/spawn/budget escape | Open. |
| Linux/macOS/Windows; Node 20/22; Python 3.11/3.12/3.13 | Partial: Linux declarations only. |
| Mock normal CI and opt-in/nightly real providers | Partial: deterministic local execution exists; provider matrix absent. |
| >10% performance regression gate | Open: no approved baseline/enforcement. |
| No unaccepted high/critical plus secret/dependency/license/static scans | Open: source scans are partial; runtime/D9/isolation/final-package scans absent. |
| Trusted npm/PyPI, SBOM, checksums, attestations | Open/External. |
| Quickstart <=3 commands and >=80% external testers <=5 minutes | Command-count slice plausible; external cohort evidence absent. |
| Zero P0/P1 and >=5 external reports | Open; this audit identifies P0/P1 blockers and no accepted external cohort exists. |

## 13. Dependency-ordered maximum-concurrency queue

The four-agent ceiling should be used on independent bounded work, with the
integration lane retaining sole ownership of shared registry/spec joins.

### Batch A — immediate, four slots

| Slot | Task | Exit condition |
|---:|---|---|
| Main/integration | Bind this audit; review D7/D9 boundaries; push `105881f` + `d5bcc018` + audit milestone | Remote SHA verified; no cross-lane files; map/evidence/docs/diff green. |
| Contract/security | Finish `D9-REDACTION-039` | Eight original contract blockers dispositioned; closed schemas/corpus; independent no-open-P0/P1 contract review; native tasks remain honest Open. |
| Cycle contract | Finish independent D7 contract review and resolve 024 status semantics | Frozen carrier/event/checkpoint/fold contract with no spec-level P0/P1; explicit handoff to 025/026. |
| Newly released audit slot | Start stale `D4-TRACE-SUBGRAPH-022` | Canonical namespace/reducer/trace and stream/artifact carrier contract, with runtime work clearly separated from later ArtifactStore. |

### Batch B — after D7 contract handoff

Run `D7-TS-CYCLES-025` and `D7-PY-CYCLES-026` in parallel, with main owning
fixtures and one reviewer slot preparing `D7-CYCLE-CONFORMANCE-027`. Neither
native lane may delegate execution semantics to the other. Require hard-stop,
seen-set, patch idempotency, reservation, cancellation and recovery tests.

### Batch C — after D9 contract freeze

Run `D9-TS-REDACTION-087` and `D9-PY-REDACTION-088` independently. Main owns
the canary corpus and `D9-REDACTION-CONFORMANCE-089`; the fourth slot performs
hostile security review. Do not start extended durability against a merely
documented protection contract.

### Batch D — parallel ready work after the two critical joins

1. `D6-ROUTER-BARRIER-023` can proceed from existing pipeline/router/barrier
   prerequisites.
2. `D10-BUDGET-SPEC-035` can freeze units/reservations once the cycle contract
   boundary is accepted; native ledgers wait for extended durability.
3. `D9-APPROVAL-077` starts after D9 contract freeze.
4. `D4-TRACE-SUBGRAPH-022` runtime implementation follows its contract and D2.

Then execute the canonical DAG without skipping joins: D9 extended durability
and operations -> budget -> verification -> isolation -> adapters/DX -> API/
plugins/pattern skeletons -> production stores/Explorer/performance -> security
-> Beta/usability -> compatibility/education/support -> RC -> provenance ->
acceptance/pattern/docs/growth roll-ups -> stable/complete-RC/no-release.

## 14. Organic growth and 6,000-star boundary

The `6,000+` star objective is a non-blocking organic stretch outcome. It cannot
be guaranteed by an engineering plan, an agent, a launch calendar, or a release
gate. The only defensible promise is to build and measure the conditions that
may produce adoption: a trustworthy product, fast mock-first success, accurate
demos, durable recovery, strong documentation, responsive contribution paths,
authentic use cases and privacy-safe metrics.

Paid stars, bots, mutual-star schemes, fake adopters, fabricated usability
reports, undisclosed promotion, or false popularity claims are prohibited. A
miss on stars changes positioning/product experiments; it never weakens a
technical, security, provenance, usability or support release gate.

## 15. Final decision

**Do not mark the 21-day master plan complete. Do not publish stable v1. Do not
call the current tree a complete RC.** Continue from the dependency-ordered
queue above. A future completion audit must use one clean immutable candidate,
revalidate all 93 required ancestors, show every mandatory checklist row Green,
close external/provenance gates with authentic evidence, and obtain independent
release/security sign-off.
