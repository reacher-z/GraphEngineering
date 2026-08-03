# Master-plan coverage matrix

Updated: 2026-07-26

This is the canonical gap ledger for the
[21-day master plan](../Graph-Engineering-21-Day-Master-Plan.md). It answers a
stricter question than the progress scanner: whether every promised capability,
test, document, release control, and adoption prerequisite has objective
evidence. A task may be healthy while its deliverable is still open. `Green`
means the named scope is implemented and verified; `Partial` means useful code
exists but the master-plan promise is broader; `Open` means there is no accepted
implementation evidence yet; `External` requires people, credentials, elapsed
time, or hosted systems outside the repository.

The matrix is append-only in meaning. A later correction must name the evidence
that supersedes an earlier assessment. Stars are an observed organic outcome,
not a shippable artifact: 6,000+ remains the breakout target, while stable-v1
eligibility depends only on the release gates below.

## Evidence rules

A row becomes Green only when all applicable evidence exists:

1. A normative contract or an explicit statement that no persistent contract is
   required.
2. Native TypeScript and Python implementations when the public surface promises
   both languages.
3. Shared, language-neutral conformance vectors for portable behavior.
4. Positive, negative, cancellation, cleanup, resource-bound, and restart tests
   appropriate to the risk.
5. User documentation and an executable, provider-free example.
6. Clean repository gates, installable artifact checks, and a reviewed commit or
   protected-branch pull request.
7. Release evidence for anything described as published, supported, secure, or
   externally validated.

Source files, enum members, planned CLI verbs, issue labels, and scanner
heartbeats are not implementation proof by themselves.

## Day-by-day delivery coverage

| Day | State | Evidence already present | Work still required for the plan | Registry control |
|---|---|---|---|---|
| 1 — contracts, ownership, governance | Partial | Public MIT repository, governance files, CI, protected `main`, canonical Graph IR/event schemas, logs, timer-backed scanner | Finish every listed planning/architecture/growth document; make completion evidence machine-verifiable; correct historical over-broad task titles | `CTRL-PLAN-COVERAGE-001`, `CTRL-EVIDENCE-002` |
| 2 — builders and canonical IR | Partial; D2 authoring milestone delivered | Commit `dd8c0f7`: strict JSON/bounded safe YAML, declaration-ordered TS/Python builders, strict typed ports, node/edge/schema identity, initial component/revision identity, shared hashes and hostile cross-language source corpus | GraphPatch/revision 2+, general schema assignability/runtime value validation, state reducers, subgraphs, executable stream/artifact edges, and later budget/capability enforcement remain in their downstream controls | `D2-BUILDERS-YAML-020` delivered at source milestone; downstream controls remain Open |
| 3 — diagnostics and CLI | Partial; initial dual-language command surface delivered | Shared invalid graph fixtures; TS and native Python `init`, `validate`, `compile`, `plan`, `doctor`; `graph`/`grapheng` entry points; stable initial envelopes/exits; Quickstart | Freeze the complete public diagnostic/API surface and add runtime/provider/score/artifact/operational commands with installed cross-platform parity | `D3-PY-CLI-021` delivered at source milestone; `D9-OPS-CONTROL-085`, `D13-DX-051`, `D14-API-FREEZE-050`, `D18-COMPAT-BENCH-064` remain Open |
| 4 — scheduler and trace view | Partial | Native deterministic DAG scheduler; chain/diamond parity; bounded ready queue | Trace viewer, nested subgraphs/namespaces, explicit state reducers, executable stream/artifact edges | `D4-TRACE-SUBGRAPH-022`, `D15-EXPLORER-060` |
| 5 — pipeline, barrier, router | Partial; standalone pipeline and integrated routing delivered | Pure barrier/router evaluators; commit `3df201d` delivers bounded TS/Python pipelines, eight shared cases, hostile cleanup/configuration tests and full package gates; the integrated-router compiler, `routedBranches` lowering, ordinary execution and zero-execution foreign-condition preflight were accepted per plan §31.35.12 | Scheduler-integrated deadline/quorum barriers, durable route-decision identity and replay, stream-edge IR activation | `D7-PIPELINE-CONFORMANCE-013` Green; routing half of `D6-ROUTER-BARRIER-023` Green; barrier half Open |
| 6 — terminal semantics and quorum | Partial; contract at revision 2, TypeScript refusal gate landed | Structured scheduler and pipeline failures; retry/timeout/cancellation; attempt budgets; upstream isolation. `spec/integrated-barrier-semantics.md` plus four schemas freeze barriers, quorum, abstention, deadlines, the closed `onUnsatisfied` set, late arrival and zero-rejudge decision replay at `implementationClaim: false`. Commit `6330204` lands the TypeScript pre-dispatch capability gate and the `GE1421`-`GE1424` pass, so a graph declaring a barrier policy is now refused before dispatch instead of executed as an identity node | Barrier execution itself: arming, dispositions, satisfaction arithmetic, deadlines, the three non-pass resolutions, late arrival, cancellation propagation, decision documents and zero-rejudge replay. Python tranche 1 and the cross-language diagnostic-order join are both outstanding, and the join is the gate that matters — §31.35.12 rejected a previous tranche for exactly that divergence | `D6-ROUTER-BARRIER-023`, `D11-VERIFY-SPEC-040` |
| 7 — bounded cycles and Alpha 1 | Partial | Source-only `v0.1.0-alpha.1` exists; static bounded-loop graph constructor exists | Executable `untilDry`, bounded `while`, evaluator-optimizer loops, global seen-set, semantic convergence, hard duration/cost/node limits and replayable exit reasons | `D7-CYCLE-SPEC-024`, `D7-TS-CYCLES-025`, `D7-PY-CYCLES-026`, `D7-CYCLE-CONFORMANCE-027` |
| 8 — retry/cancel operations | Partial | Native retry, timeout, cancellation and pipeline cleanup suites | Runtime chaos is isolated from durable operational commands; both must join without deadlock, leaks, unbounded retry or stale control | `D8-RUNTIME-CHAOS-084`, `D9-OPS-CONTROL-085`, `D8-CHAOS-OPS-030` |
| 9 — durable execution | Partial, strong local-DAG slice; critical redaction open | Event-sourced start/resume, CAS event stores, file checkpoints, stable activity keys, terminal idempotence, cross-language interrupted-history recovery | Freeze redaction/approval contracts, implement independent TS/Python sink-before-write lanes and canary join, then add Lease/LockManager, checkpoint acceleration, SQLite, ArtifactStore, replay/fork, non-idempotent confirmation and dual-resume races | `D9-REDACTION-039`, `D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`, `D9-REDACTION-CONFORMANCE-089`, `D9-APPROVAL-077`, `D9-DURABLE-EXT-*` |
| 10 — budget/model/cost | Open | Graph-level concurrency/attempt limits provide a narrow bound | Token/money/time/node budgets, atomic reservations, model tier/router, usage and pricing snapshots, cost command/UI, hard stop before scheduling | `D10-BUDGET-SPEC-035`, `D10-TS-BUDGET-036`, `D10-PY-BUDGET-037`, `D10-BUDGET-CONFORMANCE-038` |
| 11 — verification | Open | Verified-fanout graph constructor is declarative only | Reflection, adversarial refutation, diverse lenses, citation verification, judge panels, versioned rubrics, votes, majority/quorum/abstention/unknown/human gating | `D11-VERIFY-SPEC-040`, `D11-TS-VERIFY-041`, `D11-PY-VERIFY-042`, `D11-VERIFY-CONFORMANCE-043` |
| 12 — isolation and policy | Open | Documentation accurately states current ambient-authority boundary | Capability manifests/enforcement, deny-by-default tool/filesystem/network/secrets, worktree leases/merge node, process/container isolation, escape tests and approvals | `D12-ISOLATION-SPEC-044`, `D12-TS-ISOLATION-045`, `D12-PY-ISOLATION-046`, `D12-ISOLATION-REDTEAM-047` |
| 13 — adapters and Alpha 2 | Open | Deterministic local mock execution | Independent TS/Python adapter lanes, shared streaming/tools/usage/retry/rate/cancel/fallback conformance, opt-in live provider evidence, doctor/score/badge | `D13-ADAPTER-SPEC-048`, `D13-TS-ADAPTERS-081`, `D13-PY-ADAPTERS-082`, `D13-ADAPTERS-049`, `D13-DX-051` |
| 14 — API freeze, plugins, patterns | Open | Read-only validation/planning MCP alpha and four TS graph constructors | Runtime MCP opt-in mutation policy, plugin SDK/discovery, public API review, all ten complete pattern skeletons and canonical unscoped npm distribution | `D14-API-FREEZE-050`, `D14-MCP-PLUGINS-052`, `D14-PATTERN-SKELETONS-053`, `D14-NPM-DIST-078` |
| 15 — production stores, workers, Explorer | Open | In-memory/JSONL events and local file checkpoints | SQLite/local artifacts default, PostgreSQL/S3 adapters, LockManager/distributed workers, React Explorer, JSONL/console/OTLP, critical-path/utilization views, first-run study | `D15-STORAGE-WORKERS-054`, `D15-EXPLORER-060`, `D15-PERFORMANCE-061` |
| 16 — security preflight | Partial | CodeQL, dependency review, Dependabot, private reporting, source package audits and an implementation-aligned security ledger | Close independent redaction conformance; complete privacy/retention, threat model, enforceable policy, secret scan, fuzz/property/chaos, license/SBOM, escape tests and zero unaccepted high/critical findings | `D9-REDACTION-CONFORMANCE-089`, `D16-PRIVACY-079`, `D16-SECURITY-062` |
| 17 — Beta | Open | Public alpha issues/discussions provide recruitment surface | First build immutable Beta/API artifacts; separately obtain consent-safe external usability evidence, at least five reports, 80% five-minute completion, retest and feedback disposition | `D17-BETA-063`, `D17-USABILITY-076` |
| 18 — compatibility and benchmark audit | Open | CI covers Node 20/22 and Python 3.11/3.12/3.13 on Linux | macOS/Windows, scale/resource tests, reproducible baselines, 100 randomized faults, education assets, support/incident readiness and no >10% unexplained regression | `D18-COMPAT-BENCH-064`, `D18-EDUCATION-ASSETS-083`, `D18-SUPPORT-READINESS-080`, `CTRL-ACCEPTANCE-070` |
| 19 — RC freeze | Open | npm tarball and Python wheel/sdist local rehearsals exist | Clean install and upgrade matrix, migration guide, full docs link/code checks, P0/P1 zero, signed `1.0.0-rc.1` candidate | `D19-RC-065` |
| 20 — provenance | Open/External | Source release and protected checks exist | Trusted npm/PyPI identity and rehearsal, checksums, SBOM, attestations and provenance verification; provenance does not self-authorize release | `D20-PROVENANCE-066` |
| 21 — release and support | Open/External; control protocol delivered | Repository, alpha release, issues and Discussions are public; immutable control commit `105881f` maps 178/178 leaves and verifies an empty fail-closed overlay at `0/93` release weight | Populate fresh exact evidence against one clean immutable candidate, run the stable-vs-RC roll-up, then publish only the authorized channel with provenance, support, authentic external evidence, and transparent metrics | `CTRL-RELEASE-MAP-074` and `CTRL-EVIDENCE-BACKFILL-075` delivered as infrastructure; `CTRL-RELEASE-ROLLUP-086`, `D21-RELEASE-067`, `CTRL-GROWTH-072` remain Open |

## Product-capability coverage

| Capability family | Current evidence | Missing acceptance evidence | State |
|---|---|---|---|
| Graph IR and compiler | Shared schema, canonical hashes, DAG compile parity, strict JSON/bounded safe YAML, TS/Python builders, strict typed ports and revision-1 identity | Dynamic GraphPatch/revision 2+, nested graphs, state reducers/conflicts, runtime schema validation and policy/budget/capability enforcement | Partial; D2 authoring source milestone Green |
| DAG scheduling | Native ready-queue schedulers, deterministic diamond | 100-way and 1,000-node bounds, worker/distributed mode, full node-kind execution | Partial |
| Pipeline | Commit `3df201d`: standalone bounded native APIs, eight shared behavioral cases, docs and full local package gates | Durable per-item semantics deliberately excluded; stream IR remains declarative | Green for standalone scope; broader Graph IR scope Open |
| Barriers | Deterministic all/minimum/percentage settled evaluator; contract candidate at revision 2 with `implementationClaim: false`; TypeScript refuses a claimed policy before dispatch and emits `GE1421`-`GE1424` | Every runtime behavior: durable wait, deadline, quorum, abstention, missing statistics, the three non-pass resolutions, late arrival and cancellation propagation. The scheduler still executes an unclaimed `barrier` as a transform, which is now a stated pre-contract boundary rather than a silent pass | Partial; refusal gate only, no execution |
| Routers | Deterministic single/multicast evaluator; integrated compiler pass `GE1401`-`GE1407`, pattern lowering, ordinary execution and pre-dispatch capability gate accepted at §31.35.12 | Dedicated durable `RouteSelected` identity and zero-rejudge replay, confidence escalation evidence at runtime | Partial; routing execution Green, durable decision Open |
| Cycles | Static finite graph constructor | Runtime bounded cycles, convergence/global seen set, budgets and exit reasons | Open |
| Dynamic GraphPatch | Schema vocabulary only | Append-only revision compiler, permissions/budget gates, dry run and malicious-patch tests | Open |
| Verification | Declarative pattern constructor | Runtime maker/verifier isolation, votes, citations, panels, reflection and unknown gates | Open |
| Durable state | Events, CAS, checkpoints, local start/resume | Leases, ArtifactStore/LockManager, SQLite/Postgres/S3, replay/fork and approvals | Partial |
| Cost/model routing | Narrow attempt/concurrency limits | Models, pricing, usage, reservations, cost views and hard budget scheduling | Open |
| Providers/tools | Deterministic local executors, read-only MCP | All official adapters and shared conformance, rate/circuit/fallback behavior | Open |
| Security/isolation | Honest boundary docs and supply-chain CI; the durable false-redaction signal is explicitly registered as a critical corrective task | Runtime enforcement, capabilities, approvals, truthful sink-before-write redaction, worktree/process/container providers | Open; `D9-REDACTION-039` blocks extension/release claims |
| Observability | Event history and Mermaid/DOT output | OTel, live status, trace/critical path metrics, web Explorer/time travel | Open |
| CLI/SDK DX | TS and native Python init/validate/compile/plan/doctor, `graph`/`grapheng`, TS visualize, packed-install smoke | Remaining operational/provider commands; scoring, badge, picker, artifacts, plugins and complete installed OS/runtime parity | Partial; initial dual-language CLI milestone Green |
| Education/patterns | Quickstarts and four TS constructors, two runnable examples | Ten complete cross-language pattern bundles and executable 14-step course | Partial |
| Release/community | Public alpha, governance, issue templates, Discussions | Trusted packages/provenance, external evidence, launch site/assets and sustained support | Partial/External |

## Ten-pattern completeness ledger

Every pattern must satisfy one bundle gate: YAML and JSON; native TS and Python;
fixtures and expected events; deterministic mock e2e; optional real-provider
setup; architecture diagram; declared token/money/time budgets; least-privilege
permissions; injected failure plus resume; tests; and Claude Code, Codex, MCP,
and shell launch guides.

| Pattern | Current evidence | State | Control |
|---|---|---|---|
| Multi-source research diamond | TS constructor and provider-free showcase | Partial | `PATTERN-01-RESEARCH` |
| Cited deep research | No citation-verifier runtime bundle | Open | `PATTERN-02-CITED` |
| Route-auth security sweep | No complete runtime bundle | Open | `PATTERN-03-AUTH` |
| Diff-risk router and judge panel | Router constructor only | Partial | `PATTERN-04-DIFF` |
| Loop-until-dry discovery | Static bounded constructor only | Partial | `PATTERN-05-UNTIL-DRY` |
| File migration with worktrees | No isolation/merge implementation | Open | `PATTERN-06-MIGRATION` |
| CI failure sweeper | No complete bundle | Open | `PATTERN-07-CI` |
| Dependency update sweeper | No complete bundle | Open | `PATTERN-08-DEPS` |
| PR babysitter | No complete bundle | Open | `PATTERN-09-PR` |
| Scheduled ecosystem scan | No scheduling/provider bundle | Open | `PATTERN-10-ECOSYSTEM` |

`D14-PATTERN-SKELETONS-053` creates the common cross-language structure;
`CTRL-PATTERNS-071` remains open until all ten rows satisfy the entire bundle
gate, not merely until ten directories exist.

## Mandatory-test ledger

| Test group | Included scenarios | Current status | Control |
|---|---|---|---|
| Compiler negatives | Missing/duplicate/unreachable nodes, ports/schemas, cycles, routers, loop bounds, unauthorized transforms | Core DAG subset Green; router/loop/policy cases open | `CTRL-ACCEPTANCE-070` |
| Parallel and streaming | 100-way concurrency, all failure policies, backpressure, barrier timeout, cancellation | Bounded pipeline and ordinary DAG subset Green; scale/deadline open | `D8-CHAOS-OPS-030`, `D18-COMPAT-BENCH-064` |
| Dynamic and verifier | Malicious patches, pass/reject/abstain, citation checks, quorum/unknown, seen-set convergence | Open | `D11-VERIFY-CONFORMANCE-043`, `D12-ISOLATION-REDTEAM-047` |
| Recovery | Every crash window, truthful redaction signal, dual resume, replay/fork, stale approvals, non-idempotent confirmation | Local DAG crash/resume subset Green; raw payloads currently contradict `redacted: true`; remaining cases open | `D9-REDACTION-039`, `D9-DURABLE-EXT-CONFORMANCE-034` |
| Isolation | Worktree conflicts, merge gate, allowed paths, port/temp/cache/database namespaces, prompt injection | Open | `D12-ISOLATION-REDTEAM-047` |
| Adapters/storage | Fallback, rate limit, circuit breaker, cancellation, secret redaction, shared storage/adapter suites | Open | `D13-ADAPTERS-049`, `D15-STORAGE-WORKERS-054` |
| Product e2e | Full CLI, all ten patterns, Explorer/replay, clean install/upgrade | Partial CLI; remainder open | `CTRL-PATTERNS-071`, `D19-RC-065` |
| Scale and chaos | 1,000 nodes, 100 randomized failures, kill/network/store/artifact faults | Open | `D18-COMPAT-BENCH-064` |

## Quantitative release thresholds

| Threshold | Current evidence | State |
|---|---|---|
| Compiler/scheduler/event store/policy coverage >=90% statements and >=85% branches | No consolidated threshold report | Open |
| >=250 unit/integration cases per language | Python exceeds the raw count; TS workspace exceeds it, but classification and coverage ownership need a release report | Partial |
| Shared adapter and storage conformance | Current compiler/runtime/persistence primitives are shared; provider and production storage matrices are absent | Partial |
| 100 randomized failure runs without deadlock/spawn/budget escape | No accepted report | Open |
| Linux/macOS/Windows; Node 20/22; Python 3.11/3.12/3.13 | Linux version matrix present; macOS and Windows absent | Partial |
| Mock normal CI; real-provider opt-in/nightly | Mock/local behavior exists; real-provider opt-in matrix absent | Partial |
| >10% performance regression blocks merge | No benchmark baseline/enforcement | Open |
| No unaccepted high/critical; secret/dependency/license/static scans pass | Several scans exist; complete secret/license/runtime-policy evidence absent | Partial |
| Trusted npm/PyPI, SBOM, checksums, attestations | Local artifacts only | Open/External |
| Quickstart <=3 commands; >=80% external testers finish <=5 minutes | Command count is within target; external study absent | Partial/External |
| Zero P0/P1 and >=5 external usability reports | No complete beta evidence | Open/External |

No stable-v1 decision may treat aggregate test count as a substitute for
coverage, portability, chaos, external usability, or provenance evidence.

## Required planning, architecture, delivery, and growth documents

| Document | State | Control |
|---|---|---|
| `research/loop-engineering-benchmark.md` | Present; refresh before major release | `CTRL-DOCS-073` |
| `research/graph-engineering-source-review.md` | Present | `CTRL-DOCS-073` |
| `research/competitor-capability-matrix.md` | Present; domain review Open | `CTRL-DOCS-073` |
| `architecture/graph-ir-and-schema.md` | Present; implementation acceptance Open | `CTRL-DOCS-073` |
| `architecture/runtime-semantics.md` | Present; implementation acceptance Open | `CTRL-DOCS-073` |
| `architecture/persistence-and-recovery.md` | Present; implementation acceptance Open | `CTRL-DOCS-073` |
| `architecture/security-and-isolation.md` | Present; independent security review Open | `CTRL-DOCS-073` |
| `architecture/cross-language-conformance.md` | Present | `CTRL-DOCS-073` |
| `delivery/master-plan-coverage-matrix.md` | Present, maintained | `CTRL-PLAN-COVERAGE-001` |
| `delivery/task-dependency-graph.md` | Present, maintained | `CTRL-PLAN-COVERAGE-001` |
| `delivery/agent-ownership-map.md` | Present, maintained | `CTRL-PLAN-COVERAGE-001` |
| `delivery/release-checklist.md` | Present, maintained; mandatory evidence rows remain Open | `CTRL-PLAN-COVERAGE-001` |
| `delivery/full-plan-gap-audit.md` | Present; findings registered, remediation Open | `CTRL-PLAN-COVERAGE-001` |
| `delivery/d2-builder-yaml-implementation-brief.md` | Present; native implementation active | `D2-BUILDERS-YAML-020` |
| `delivery/d9-redaction-implementation-brief.md` | Present; critical implementation Open | `D9-REDACTION-039` |
| `growth/launch-plan.md` | Present as plan; launch execution Open | `CTRL-GROWTH-072` |
| `growth/content-calendar.md` | Present as plan; scheduled execution Open | `CTRL-GROWTH-072` |
| `growth/metrics-and-experiments.md` | Present as plan; observed outcomes Open | `CTRL-GROWTH-072` |

## Post-audit registry closure

The 2026-07-26 full-plan audit added 16 explicit controls instead of leaving
their work hidden inside broad aggregate tasks:

| Closure family | New controls | Release effect |
|---|---|---|
| Machine evidence and decision | `CTRL-RELEASE-MAP-074`, `CTRL-EVIDENCE-BACKFILL-075`, `CTRL-RELEASE-ROLLUP-086` | Every `REL-*` leaf must map 178/178; historical status has zero candidate weight without revalidation; stable/RC decision fails closed. |
| Authority, privacy, usability, support | `D9-APPROVAL-077`, `D16-PRIVACY-079`, `D17-USABILITY-076`, `D18-SUPPORT-READINESS-080` | Human authority, consent, elapsed external evidence and support readiness can block release and cannot be fabricated. |
| Independent native lanes | `D13-TS-ADAPTERS-081`, `D13-PY-ADAPTERS-082`, `D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`, `D9-REDACTION-CONFORMANCE-089` | Implementers no longer self-certify cross-language adapters or critical secret handling. |
| Runtime, operations, distribution, education | `D8-RUNTIME-CHAOS-084`, `D9-OPS-CONTROL-085`, `D14-NPM-DIST-078`, `D18-EDUCATION-ASSETS-083` | Chaos no longer blocks early durable specs; operations, canonical package and executable education each have independent gates. |

Registry check at this checkpoint: 107 tasks, 107 unique IDs, zero dangling
dependencies, zero cycles, and `updated_at` not older than any task timestamp.
At this registry-expansion checkpoint the scanner reported 6 of 77
evidence-required tasks satisfied. Later timer-backed scans supersede that
historical count; neither liveness nor a higher count is a stable-release claim.

## Exit rule

The master plan is complete only when every capability and pattern row is Green,
every mandatory-test and quantitative threshold has a durable evidence link, all
required documents exist and pass checks, package provenance is verified, and
the release checklist records a go decision. External adoption and the 6,000+
star target are reported honestly as outcomes; they cannot be fabricated or
declared complete by code changes.

## 2026-08-02 PDT control-truth reconciliation

This append supersedes only stale checkpoint counts above; it does not upgrade
any capability, release, or adoption claim that lacks its own evidence.

- The registry now contains 111 unique tasks. The new narrow controls are
  `D9-SQLITE-RULE11-PREDECESSOR-091`,
  `D9-SQLITE-PUBLICATION-TX-OWNER-092`, and
  `D9-SQLITE-RULE12-CLOCK-P10-093`; they prevent the substantial B3/P9/P10
  SQLite work from remaining invisible inside the broader planned D9 durable
  extension tasks.
- P9 is Green only for its bounded package-private scope: dual-runtime owner
  registration, 19 semantic guard classes, guarded `BEGIN EXCLUSIVE`,
  authenticated returned-failure cleanup, portable parity, GC/privacy checks,
  and a hard-disabled COMMIT path. Its immutable implementation commit is
  `1cb77f03bcfd785183cbaf819a02c287308e9bc0` and its review is
  `codex_logs/reviews/SQLITE-PUBLICATION-TRANSACTION-OWNER-RUNTIME-WAVE1E-P9-2026-08-02.md`.
  It is not evidence for the complete D9 store/recovery surface.
- P10 is In Progress. Its frozen boundary is exact Rule 11 consumption, bounded
  Rule 12 main/TEMP seal acceptance, and one authenticated but unconsumed
  `before-verification` clock observation (`3/2`). Cursor-clock completion,
  TEMP retirement, the fourth clock, final fence, COMMIT, complete-v2, and
  release remain explicitly outside P10.
- A fresh scanner run after reconciliation reported 111 tasks, 47 healthy, 61
  waiting, 3 stale, 0 blocked, 0 integration risks, and 15 of 81 evidence gates
  satisfied. Scanner health remains liveness evidence only.
- A fresh release-map check passed 178/178 leaves (175 blocking and 3
  non-blocking), with 111 registry tasks and an acyclic dependency graph. This
  proves mapping integrity, not release readiness.
- A fresh evidence-closure audit remained `audit-only`, with no candidate,
  zero selected tasks, and release weight `0/93`. The 178 release-checklist
  leaves therefore remain Open for a candidate-bound stable/RC decision.
- The reconciliation initially proved that the planning documents named
  `scripts/check-task-registry.mjs` and `scripts/check-task-graph.mjs` while
  neither executable existed. This checkpoint closes that control gap: both
  commands now reject duplicate-key JSON and validate task shape, canonical
  timestamps/chronology, artifact paths, dependency existence/cycles,
  documented task references, 70 required semantic edges and completion
  invalidation. `pnpm check:task-controls` runs twelve focused hostile tests in
  CI. Candidate mode reads the registry and artifact entries from immutable Git
  objects instead of the dirty worktree. Release-strict mode cannot be waived
  with `evidence_required:false` and intentionally fails until historical
  completed tasks receive the missing candidate-bound evidence, so structural
  health cannot masquerade as evidence closure.

The highest-fan-out repository-owned gates remain D9 redaction, D4
subgraph/reducer/artifact/stream/trace, D6 barrier tranche 2, and D7 native
cycle/conformance closure. P10 may proceed in its independent SQLite lane, but
it must not consume all implementation capacity while those release-spine
predecessors remain Open.

## 2026-08-03 PDT P10 immutable acceptance and P11 composition truth

- P10 is Green only for its bounded Rule 12 plus unconsumed third-clock scope.
  Immutable implementation commit:
  `e8e2598fa78e11427684be727c4198f6ce2ba02b`. Native focused, exact
  cross-runtime parity, static/build, affected regressions and the complete
  SQLite suite passed; independent disposition is H0/M0/L0.
- P10's terminal facts are Rule12 accepted, third evidence observed but not
  consumed, provider clock observed/consumed `3/2`, and COMMIT not presented.
  It does not close cursor-clock, TEMP retirement, final fence, complete-v2,
  public API, D9, RC, stable release, or external adoption.
- `D9-SQLITE-OWNER-COMPOSITION-P11-094` is In Progress. Immutable bounded
  substrate commit `02fffe7e3c7dbf54439454568c303f944c4c7f75` supplies the
  machine contract, TypeScript zero-I/O authority lattice, and Python
  exact-primary/adoption substrate. It does not yet make the P9 owner and P10
  publication predecessor one transitive native runtime authority graph.
  Python scope/read parity, actual native route closure, runtime-real resource
  retirement, portable parity, and every P11-B/C/D slice remain Open while
  COMMIT and release weight stay disabled.
- Immutable tranche `7448c27f1b09e3feaa7021e378f5ccd7fcc66141`
  adds dual-runtime zero-I/O scope/read parity, route-bound count-policy guards,
  definition-time hostile cleanup, and deterministic native-callsite discovery.
  Its production scan deliberately leaves 457/457 candidates unknown; it adds
  no native route-closure, runtime-real retirement, P11 completion, or release
  weight.
- Registry expansion to 112 tasks and P10 completion do not change release
  weight. Candidate-bound evidence closure remains audit-only at 0/93 until a
  future immutable release candidate closes every release-rollup predecessor.

## 2026-08-03 PDT P11 count provenance and triage checkpoint

- Immutable commit `90fae463db5ef3097cf4b21ff4e07517edfbebd0` adds the
  dual-runtime retained-projection count receipt and deterministic conservative
  TypeScript/Python callsite classification. Independent disposition is
  H0/M0/L0.
- The scanner remains a 457-callsite, route-unknown inventory. The 15
  TypeScript and 187 Python confirmed-native receivers define the next mapping
  set only; they do not authorize any route.
- P11 stays In Progress with no completed-test evidence or release weight.
  Native projection ownership, runtime-real fixed-read retirement, exact route
  contracts, and P11-B/C/D remain Open. Evidence closure stays audit-only 0/93.
