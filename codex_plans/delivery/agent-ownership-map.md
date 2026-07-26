# Graph Engineering agent ownership and review map

- Authority: [Graph Engineering 21-Day Master Plan](../Graph-Engineering-21-Day-Master-Plan.md)
- Dependency model: [task dependency graph](task-dependency-graph.md)
- Current gap authority: [master-plan coverage matrix](master-plan-coverage-matrix.md)
- Stable-release gates: [release checklist](release-checklist.md)
- Live assignment source: [task registry](../../codex_logs/task-registry.json)
- Repository boundary rules: [AGENTS.md](../../AGENTS.md)
- Snapshot date: 2026-07-26

This document assigns accountable roles, review roles, and file boundaries for
every lane and every day of the 21-day plan. It is an execution control, not a
completion report. A role listed here is not an active assignment until the
task registry names an agent and dependency state. A deliverable is not complete
until its exit evidence is accepted under the release checklist.

The four-lane limit is fixed: integration, TypeScript runtime, Python runtime,
and platform/quality/growth. Review work is time-sliced into the two daily
integration windows; reviewer labels do not create hidden fifth or sixth
implementation lanes.

## 1. Role vocabulary and accountability

| Code | Accountable role | Primary responsibilities | May merge or declare gate state? |
|---|---|---|---|
| `INT` | Main/integration agent | Canonical protocol, architecture decisions, shared fixtures, dependency ordering, cross-language joins, root configuration, risk acceptance, release decision | May integrate after required reviews; is the only role that may record a cross-lane join or release decision |
| `TSR` | TypeScript runtime agent | Native TypeScript compiler/runtime/SDK, Node adapters, npm package behavior, focused tests and package documentation | May hand off a reviewed package change; cannot self-approve a shared semantic or release gate |
| `PYR` | Python runtime agent | Native Python compiler/runtime/SDK, Python adapters and CLI/library behavior, PyPI package behavior, focused tests and package documentation | May hand off a reviewed package change; cannot self-approve a shared semantic or release gate |
| `PQG` | Platform/quality/growth agent | CLI, MCP, Explorer/site, examples, patterns, conformance runners, matrices, docs, security/QA assets, tester operations and organic launch assets | May hand off platform artifacts; cannot turn a mock or content asset into runtime evidence |
| `SRV` | Security/release reviewer duty | Threat, capability, supply-chain, provenance, package and claim review; normally performed by `INT` plus the non-author lane during an integration window | Advisory until evidence is signed; never bypasses a failed technical gate |
| `EXT` | External tester or independent specialist | Usability reports, consented adopter evidence, legal/security review where required, independent go/no-go review | Supplies external evidence only; cannot be simulated by a maintainer agent |

Agent identifiers are ephemeral. Registry tasks bind an identifier to one of
these roles for one bounded work package. Reassignment must preserve the prior
owner, reason, last accepted evidence, uncommitted-file manifest, and new owner.

### Accountability rules

1. One work package has one primary owner. “Main + agent” means `INT` owns the
   contract or join while the named lane owns only its bounded implementation.
2. The primary owner writes code and focused tests, assembles the handoff
   packet, and reports exclusions. A reviewer does not quietly finish missing
   implementation while claiming to have reviewed it.
3. `INT` owns the final merge, shared-fixture interpretation, status change,
   release label, and any waiver explicitly allowed by the master plan.
4. `PQG` owns evidence collection mechanics, but the producing lane owns the
   truth of the measured behavior. A dashboard cannot promote an unreviewed
   result.
5. `EXT` evidence is required for external-usability and authentic-adoption
   gates. An agent-authored report can prepare the method but cannot count as an
   external report.

## 2. Review levels and two-person controls

“Reviewed” always means a distinct identity from the author. The minimum
two-person control is the author plus one independent reviewer. High-risk joins
require two independent reviewers in addition to the author.

| Level | Minimum identities | Applies to | Required reviewers |
|---|---:|---|---|
| `R1` | 2 total | Package-local implementation with no public semantic, security, persistence, or release impact | Author plus one non-author lane reviewer; `INT` still integrates if root/shared files change |
| `R2` | 3 total | Public API, shared semantics, cross-language behavior, cancellation/resource bounds, persistence/recovery, providers, isolation, CLI envelopes, packages | Author, opposite native-runtime semantic reviewer, and `INT` integration reviewer; for platform work use `INT` plus the relevant native lane |
| `R3` | 3 total plus required external evidence | Security go/no-go, stable release, provenance, usability threshold, public case/adopter claims | `INT`, independent `SRV` or go/no-go reviewer, and the responsible lane; add `EXT` evidence where the gate requires it |

Standard review rotation:

| Authored surface | Semantic reviewer | Integration/risk reviewer | Prohibited self-review shortcut |
|---|---|---|---|
| `spec/**` or shared fixture | `TSR` and `PYR` both review native implementability | `INT` records the decision; `PQG` checks fixture/tool usability when relevant | A contract author cannot use one passing runtime as the definition of the contract |
| TypeScript runtime/package | `PYR` checks portable behavior against spec and fixtures | `INT` checks scope, evidence and downstream impact | A TS unit test alone cannot close parity |
| Python runtime/package | `TSR` checks portable behavior against spec and fixtures | `INT` checks scope, evidence and downstream impact | A Python unit test alone cannot close parity |
| CLI/MCP/Explorer/tool/docs/example | Relevant `TSR` or `PYR` owner checks the consumed API | `INT` checks claims, safety and public envelope | A screenshot, mock, or docs build cannot close runtime behavior |
| Security/isolation/provider/store | Opposite runtime reviewer plus `PQG` adversarial test owner | `INT`/`SRV` signs risk disposition | The implementer cannot be the only exploit or fault-injection author |
| Package/release/provenance | Package lane checks install artifact | `INT` plus independent `SRV`/go-no-go reviewer | Local source tests cannot substitute for packed clean-install and provenance evidence |

An `R2` or `R3` reviewer must record one of `accepted`, `changes-requested`, or
`blocked`, cite the reviewed revision, and list commands actually run. Silence,
a heartbeat, or “looks good” is not review evidence.

## 3. File ownership and write leases

The table is the default ownership map. A task-specific handoff may narrow or
temporarily transfer a path, but it must be explicit before the first write.

| Path or artifact class | Default writer | Required reviewer(s) | Parallel safety boundary |
|---|---|---|---|
| `spec/**`, especially schemas and `spec/conformance/**` | `INT` | Both `TSR` and `PYR`; `PQG` for runner compatibility | Native lanes read the frozen revision and never patch a fixture to make only their implementation pass |
| Root `package.json`, workspace/lockfiles, root `tsconfig*`, root release metadata | `INT` | Affected package lane plus `PQG` for package/install jobs | Dependency requests are handed to `INT`; no concurrent lockfile writers |
| `.github/**`, root `README.md`, `SECURITY.md`, governance and root `scripts/**` | `INT` | `PQG` plus `SRV` for security/release changes | `PQG` drafts in owned files or a patch handoff; public claims are merged only after implementation evidence |
| `packages/core/**`, `packages/runtime/**` | `TSR` | `PYR` semantic review and `INT` integration | One active TS package claim; do not run rewriting formatters across other packages |
| `packages/primitives/**`, `packages/persistence/**` | `TSR` when assigned | `PYR` parity review and `INT` integration | Contract revision is frozen first; package-local changes remain separate from core/runtime changes when possible |
| Future TS provider, storage, worker, policy or isolation packages | `TSR` after an explicit path claim | `PYR`, `PQG` adversarial owner, `INT` | New package name and public boundary are approved before scaffolding; no shared root dependency edit by the lane |
| `python/**` | `PYR` | `TSR` semantic review and `INT` integration | Python is a native runtime, not a TS client; one active Python module family per work package |
| `packages/cli/**`, `packages/mcp-server/**`, `packages/patterns/**` | `PQG` when assigned | Relevant native lane plus `INT` | Platform may scaffold against released interfaces, but mock-only behavior stays labeled and cannot imply runtime lowering |
| `apps/**`, `docs/**`, `examples/**` | `PQG` | `INT` claim review; relevant native lane for executable examples | Example code is tested against packed/public APIs; generated screenshots do not authorize API changes |
| `tools/**`, including conformance report emitters and progress scanner | `PQG` unless `INT` explicitly assigns one file | `INT`; both runtime lanes for cross-language report semantics | Fixture authority remains in `spec/**`; report tools normalize only contract-approved diagnostic differences |
| `codex_plans/**`, `codex_logs/**` and task registry | `INT` | A non-author lane for high-risk control documents | Logs are append-only in meaning; assigned agents may edit only the exact delegated control file |
| Build output (`dist/**`), caches, virtual environments, `node_modules/**` | No manual owner | Generated-artifact/package checks | Never hand-edit or treat generated files as source evidence; clean artifacts before release comparisons |

### Write-lease rules

1. Before editing, the registry task names the exact path set, contract revision,
   branch/worktree, primary owner, reviewers, dependencies and expected tests.
2. A lane may hold one active write lease. Read-only audit work may run in
   parallel but must not mutate another lane’s files.
3. Shared paths are serialized by `INT`. If two tasks need the same file, the
   later task waits or receives an explicit handoff; “small edit” is not an
   exception.
4. A lane does not amend, reset, discard or reformat another lane’s uncommitted
   work. Overlap is reported with the exact files and stopped before editing.
5. Package dependency additions are proposed with package, version range,
   license, reason and affected lockfiles. `INT` applies the root/lockfile
   change in the integration window.
6. Generated protocol code, if introduced, is regenerated by one integration
   task from a named spec revision; native lanes do not independently regenerate
   and race.
7. External writes—publishing, posting, inviting, package ownership, hosted
   deployment—need explicit authority and a dry-run or preview. A terminal
   instruction does not broaden authority.

## 4. Day 1–21 lane map

Each row names the primary role, owned source area, required review and accepted
evidence. “Current gap” is a 2026-07-26 snapshot from the coverage matrix; it
must be rechecked against the live registry before assignment. `Partial` never
means the day gate passed.

### Wave 0–1: authority, canonical data and compiler

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **1** | Materialize plan/control set; freeze initial IR/event namespace and ADRs; record repository, registry and authority risks. Own `spec/**`, root config, `codex_plans/**`, `codex_logs/**`. | Bootstrap Node 20+ workspace and strict package foundations in `packages/core/**` and `packages/runtime/**`. | Bootstrap Python 3.11+ package, typing and test foundations in `python/**`. | Establish CI/governance, progress scanner, registry audit and onboarding shell in `.github/**` drafts, `tools/**`, `docs/**`, `packages/cli/**`. | `R2`: both native lanes review contract implementability; `PQG` reviews operational controls; `INT` accepts only with plan/risk/owner manifest, clean bootstrap tests and recorded external blockers. | **Partial.** Public repo, CI, governance, schemas and scanner exist. Several planned architecture/growth controls remain open; historical registry tasks lack explicit reviewer evidence; this ownership map was itself missing. |
| **2** | Review/freeze canonical serialization, protocol revision and hash fixtures. Own shared canonical corpus and any freeze ADR. | Implement general TS builders, schema types and stable content/revision hashes. Own `packages/core/**`. | Implement Python builders/Pydantic models with the same canonical projection. Own `python/**`. | Maintain JSON Schema, negative fixture tooling and CLI contract without changing semantics. Own `tools/**` and `packages/cli/**`; fixture edits go through `INT`. | `R2`: TS and Python cross-review; `INT` compares canonical bytes/hashes (`X01`); evidence includes fixture IDs, exact commands, both runtime revisions and mutation/negative tests. | **D2 source milestone delivered in `dd8c0f7`.** Strict JSON/bounded YAML, both builders, strict typed ports and revision-1 identity passed independent review and clean package/conformance gates. GraphPatch/revision 2+, general schema assignability, runtime value validation, reducers, subgraphs and downstream budget/capability enforcement remain Open. |
| **3** | Freeze ordered diagnostics, stable codes, JSON envelope and exit-code semantics. | Implement compiler/DAG validation and TS public compiler API. | Implement compiler/DAG validation and Python public compiler API. | Implement `init`, `validate`, `compile`, `plan`, Quickstart v0 and machine-readable CLI tests. | `R2`: native lanes review each other against invalid fixtures (`X02`); `INT` reviews CLI envelope; evidence includes all negative fixture verdicts, stdout/stderr/exit tests and packed example. | **Initial dual-language CLI milestone delivered in `dd8c0f7`.** Native Python `graph`/`grapheng` and initial command/envelope/exit parity pass wheel/sdist smoke. Complete diagnostics/API freeze, runtime/provider/score/artifact/operational commands and installed cross-platform parity remain Open. |

### Wave 2: deterministic execution, primitives and honest Alpha 1

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **4** | Integrate chain/diamond semantics, event constraints and terminal envelopes. | Implement deterministic ready-queue scheduler and bounded fan-out/fan-in in `packages/runtime/**`. | Implement equivalent native scheduler in `python/**`. | Build trace-view scaffold and deterministic concurrency tests from real event output. | `R2`: opposite runtime reviews scheduling; `INT` runs shared diamond/event-order conformance (`X05`); evidence includes bounded concurrency probes, deterministic mock traces and mutation isolation. | **Partial.** Native DAG/diamond schedulers are present. Trace viewer, nested subgraphs/namespaces, explicit reducers and executable stream/artifact edges remain open. |
| **5** | Freeze standalone pipeline and scheduler barrier semantics; prevent docs from conflating standalone streams with Graph IR stream edges. | Implement bounded pipeline, barrier integration and backpressure; own runtime/primitives package claim. | Implement native bounded pipeline and barrier parity in `python/**`. | Build provider-free research demo, slow-consumer/no-barrier probes and reproducible benchmark harness. | `R2`: TS/Python cross-review cancellation, queue bounds and wire projections; `INT` owns fixture; evidence includes fast-item gate, slow-consumer probe, stop/drop/dead-letter, timeout/retry, cleanup and repeated deterministic reports (`X04`). | **Standalone pipeline scope delivered in `3df201d`.** Pure barriers/routers and bounded native pipelines are integrated; scheduler deadlines/quorum, conditional edges, durable route replay/confidence escalation and Graph IR stream-edge activation remain Open. |
| **6** | Freeze state machine, terminal/run failure envelopes, quorum and unknown semantics. | Implement runtime router, failure propagation and quorum behavior. | Implement native router/failure/quorum parity. | Build diff-review flow and deterministic failure-injection matrix. | `R2`: both runtimes compare terminal states/codes (`X03`, `X06`); `INT` checks no null substitution; evidence covers every route/default/quorum/failure policy and unknown escalation. | **Partial.** Structured scheduler/pipeline failures and pure routing exist; full node/edge terminal set, runtime quorum/abstention, conditional routing, human/unknown escalation and injection matrix remain open. |
| **7** | Integrate bounded-cycle contract and produce an honest Alpha 1 scope/exclusion record. | Implement `untilDry`, bounded `while`, evaluator-optimizer and dynamic-patch limits in TS. | Implement identical cycle/convergence behavior in Python. | Build discovery demo, provider-free examples and evidence-backed build-in-public assets. | `R2`: native cross-review plus `INT` seen-set/budget review; evidence includes global-seen dedupe, every hard stop, explicit exit reasons, malicious/unbounded rejection and clean package install. Tag evidence cannot replace missing cycle evidence. | **Partial.** Source `v0.1.0-alpha.1` and a static graph constructor exist; executable cycles, semantic convergence, global seen set, hard duration/cost/node/fan-out limits and replayable exits are open. |

### Wave 3: retry, recovery, budgets and verification

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **8** | Review attempt accounting and cancellation precedence across runtime, source, provider and tool boundaries. | Close TS retry/timeout/cancel races, propagated abort and cleanup. | Close Python retry/timeout/cancel races, propagated cancellation and cleanup. | Build chaos matrix and `status/watch/inspect/logs/pause/resume/cancel/retry` UX against real runtime state. | `R2`: opposite runtime red-team plus `INT`; evidence includes pre-start, queued, running, retry-delay, downstream-admission, late-outcome and no-task/listener-leak cases, then randomized bounded runs (`X07`). | **Partial.** Strong native retry/cancel suites exist, including pipeline adversarial work; full chaos matrix, operational commands and proof across all future executors/providers remain open. |
| **9** | Freeze truthful redaction plus complete Event/Checkpoint/Artifact/Lock contracts, recovery state machine and non-idempotent approval rule. | Correct the TS `redacted` wire/payload boundary, then implement leases/CAS, acceleration, SQLite, artifacts, replay/fork and approvals. | Implement native Python redaction and recovery parity. | Build canary-secret, crash-window/dual-resume and run-history/time-travel evidence. | `R3` for `D9-REDACTION-039`, then `R2` recovery review; `SRV` reviews secret and external-effect boundaries. Evidence includes canary absence across every sink, truthful flags, every crash window, dual-resume, replay/fork, stale approval and confirmation (`T19-T22`, `T26`, `T30`). | **Partial, critical corrective open.** Immutable local-DAG start/resume exists, but events currently persist raw input/output while claiming `redacted: true`; redaction, LockManager/leases, acceleration, stores, replay/fork, approvals and complete races remain open. |
| **10** | Freeze atomic budget reservation, pricing snapshot and deterministic model-routing contract. | Implement TS cost/token/time/node/attempt budgets and model router. | Implement Python budget/model parity. | Build `graph cost`, cost UI, pricing snapshot updater and offline mock scenarios. | `R2`: native parity plus `INT` recovery/budget review; evidence proves a hard limit stops before new scheduling and survives resume, unknown cost fails safely, and pricing versions are retained. | **Open.** Only narrow graph concurrency/attempt bounds exist; model tiers, usage, pricing, atomic reservations, UI/CLI and hard money/token/time/node stops are unimplemented. |
| **11** | Freeze verifier/vote/rubric/evidence/abstention/human-gate semantics. | Implement TS reflection, adversarial refutation, diverse judges and citation verification. | Implement native Python verifier/judge parity. | Build cited-report pattern, verifier fixtures, retained-vote inspection and authentic demo. | `R2`: opposite runtime and `INT`; `PQG` supplies adversarial evidence. Evidence covers pass/reject/abstain, insufficient quorum, tie-break version, isolated maker/verifier contexts and original evidence retention (`I09`, `T16`). | **Open.** A declarative verified-fanout constructor is not runtime verification; panels, citations, reflection, votes, rubrics and unknown/human gates remain open. |

### Wave 4: isolation, adapters and public API freeze

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **12** | Freeze capability manifest, approval, isolation, worktree lease and merge-node contract; conduct threat review. | Implement TS worktree/process/container providers, path policy and structured merge conflicts. | Implement equivalent Python isolation providers and policy enforcement. | Build migration demo, escape/conflict/prompt-injection suite and cleanup tooling. | `R3`: both native semantics, `PQG` adversarial owner, independent `SRV`, `INT` risk disposition. Evidence covers tool/fs/network/secret denial, lease ownership, ports/temp/cache/db namespaces, preserved conflict work and cleanup (`T09`, `T23-T24`, `T28`). | **Open.** Current documentation accurately admits ambient authority; enforceable capabilities, worktrees, merge gate, process/container isolation and escape tests do not yet exist. |
| **13** | Freeze shared adapter contract and integrate honestly scoped Alpha 2. | Implement TS mock/OpenAI/Anthropic/Gemini/compatible-local/HTTP/shell/MCP adapters. | Implement Python adapters to the same discovery/stream/tools/usage/retry/rate/cancel contract. | Implement doctor/Graph Ready score/badge/visualize improvements and opt-in live-test harness. | `R2`, with `R3` for shell/MCP: native lanes cross-review; `INT` and `SRV` review capabilities. Evidence uses deterministic mock in normal CI, opt-in real providers, fallback/circuit/rate/cancel tests and package install. | **Open.** Deterministic local executors exist, but official adapters, shared adapter suite, fallback/circuit behavior and complete doctor/score/badge surface are absent. |
| **14** | Perform public API/IR compatibility audit and record freeze or explicit exclusions. | Freeze TS runtime/MCP extension interfaces and compatibility tests. | Freeze Python plugin extension interfaces, discovery and compatibility tests. | Deliver read-only-default MCP policy and ten cross-language pattern skeletons. | `R2`: both runtimes and `INT` sign API diff; `SRV` signs MCP mutation boundary. Evidence includes public export manifests, semver/API report, plugin/MCP denial tests and ten skeleton manifests. | **Open.** Alpha MCP is read-only validation/planning and four TS constructors exist; plugin SDK, runtime mutation policy, complete public freeze and ten YAML/JSON/TS/Python skeletons remain open. |

### Wave 5: scale, security and tester-backed Beta

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **15** | Review performance methodology, storage/worker contract and approved baselines. | Implement TS PostgreSQL, S3-compatible artifacts, LockManager/worker mode and OTel hooks. | Implement Python storage/worker/telemetry parity. | Build Explorer/site/video, critical-path/utilization views and clean first-run study. | `R2`: storage parity plus `INT`; `PQG` verifies benchmark environment. Evidence includes shared store suite, 1,000-node/resource runs, worker races, before/after baselines and under-five-minute first run. | **Open.** Local events/checkpoints exist; production stores, local ArtifactStore default, distributed workers, OTel, Explorer/time travel and accepted performance baseline are absent. |
| **16** | Run security preflight, require closed `D9-REDACTION-039`, own risk register and reject unaccepted high/critical findings. | Independently harden/retest TS redaction, policy and adapter/isolation boundaries. | Independently harden/retest Python redaction, policy and adapter/isolation boundaries. | Own canary scans, threat model, secret/dependency/license/static scans, fuzz/property/chaos and SBOM generation. | `R3`: implementer cannot be sole attacker; `SRV` and `INT` sign. Evidence includes scanner versions/raw reports, canary bytes absent from every sink, exploit regressions, default-off capture, SBOM/license inventory and zero unaccepted high/critical findings. | **Partial.** CodeQL/dependency review/Dependabot/private reporting and the security ledger exist; corrective redaction, runtime policy, threat model, secret/license scans, fuzz/chaos, SBOM and escape campaigns remain open. |
| **17** | Integrate Beta candidate, triage P0/P1 defects and bind all evidence to one immutable revision. | Burn down TS release blockers and produce npm beta artifact. | Burn down Python blockers and produce wheel/sdist beta artifacts. | Complete API docs, external tester protocol, feedback intake and beta onboarding. | `R3`: `INT` plus independent go/no-go reviewer; `EXT` supplies at least five reports. Evidence includes package digests, no-P0/P1 query, anonymized cohort, timing method and at least 80% five-minute success. | **Open/External.** Public alpha recruitment surface exists; beta artifacts, full docs, accepted tester reports, timing cohort and feedback triage are missing. |

### Wave 6: compatibility, RC, provenance and release/support

| Day | Integration lane (`INT`) | TypeScript lane (`TSR`) | Python lane (`PYR`) | Platform/quality/growth lane (`PQG`) | Review and join evidence | Current gap |
|---|---|---|---|---|---|---|
| **18** | Own complete compatibility audit and block RC on any `X01-X10` divergence. | Fix TS parity/platform defects without reopening frozen features. | Fix Python parity/platform defects without reopening frozen features. | Run reproducible benchmarks, 100 randomized failures, OS/version matrices, ten pattern E2E and launch-claim audit. | `R2`: native cross-review and `INT`; evidence includes Linux/macOS/Windows, Node 20/22, Python 3.11-3.13, 100-way/1,000-node tests, coverage and no unexplained >10% regression. | **Open.** Linux version CI and many tests exist; macOS/Windows, accepted coverage report, scale/resource baseline, 100 fault runs, full parity audit and ten pattern E2E are absent. |
| **19** | Freeze `1.0.0-rc.1`, permit only reviewed release-blocker fixes and invalidate artifacts after any change. | Run clean npm install/upgrade and API compatibility matrix. | Run clean wheel/sdist install/upgrade and migration matrix. | Run documentation/link/code tests and assemble release/support matrix. | `R3`: package lanes, `INT`, independent release reviewer. Evidence includes clean external projects/environments, artifact digests, migration guide, doc tests and zero P0/P1. | **Open.** Local npm tarball and Python build rehearsals exist; clean OS install/upgrade matrix, migration evidence, full docs checks and signed RC candidate are absent. |
| **20** | Own provenance/go-no-go roll-up, candidate coordinates, package identity and fallback decision. | Rehearse least-privilege npm trusted publishing and verify provenance. | Rehearse least-privilege PyPI trusted publishing and verify provenance. | Produce SBOM/checksums/attestations, site/assets/community readiness and claim audit. | `R3`: independent security and go/no-go reviewers. Evidence must link every mandatory checklist leaf, two clean build manifests, package digests, identity configuration and explicit Open/Partial/Blocked list. | **Open/External.** Source release/protected checks exist; trusted registry identity, attestations, checksums, SBOM, hosted assets and formal candidate-bound go/no-go record remain missing. |
| **21** | Choose stable only if every conjunctive v1 gate is Green; otherwise release/support the complete, accurately labeled RC. Own incident and next-review decision. | Publish/support npm only with explicit authority; deprecate/forward-fix rather than rewrite. | Publish/support PyPI only with explicit authority; yank/deprecate only under policy and publish a new fixed version. | Coordinate GitHub/site/content/community launch, metrics, support rota and transparent limitations. | `R3`: release manager, independent go/no-go and security reviewer; `EXT` evidence remains linked. Evidence includes signed decision, immutable source/artifact identities, support/incident runbooks, current links and post-release monitoring. | **Open/External.** Public alpha exists. Stable v1, packages/site, full asset set, external usability/adoption evidence and support operations are not complete. A full RC is the required fallback if any gate stays non-Green. |

## 5. Cross-cutting capability ownership

Day rows do not replace capability closure. These owners remain accountable
across days and must join the release checklist.

| Capability | Primary assembly owner | Required contributors/reviewers | File domain | Closure evidence and present gap |
|---|---|---|---|---|
| `S01` Graph IR/compiler | `INT` | `TSR`, `PYR`, `PQG` fixture runner | `spec/**`, native model/compiler paths | Canonical hashes and DAG subset exist; full builders/YAML/node kinds/typed ports/nested graphs/policy diagnostics remain Partial. |
| `S02` execution primitives | `INT` | Both native lanes; `PQG` adversarial suite | runtime/primitives, `python/**`, fixtures | DAG and standalone pipeline slices exist; dynamic patches, integrated streams/barriers/routers, subgraphs, humans and cycles remain open/partial. |
| `S03` durable execution | `INT` | `TSR`, `PYR`, `PQG` crash/canary harness, `SRV` secret and side-effect review | spec, persistence/runtime, Python stores | Local immutable-DAG start/resume exists; `D9-REDACTION-039` and complete leases/stores/replay/fork/approval remain open. |
| `S04` providers/tools | `INT` contract; native lanes implement | `PQG` conformance/security; `SRV` for shell/MCP | future TS adapter packages, `python/**`, tools | Deterministic mock only; official adapter surface is Open. |
| `S05` policy/isolation | `INT` contract | Both native lanes; `PQG` red-team; `SRV` | future isolation/policy packages, persistence/runtime, Python, docs | Honest boundary docs exist; truthful redaction, enforceable deny-by-default and isolation are Open. |
| `S06` observability/Explorer | `PQG` assembly | Native event/OTel producers; `INT` claim review; `SRV` redaction review | `apps/**`, docs/tools, native telemetry | Event history/Mermaid/DOT exist; truthful sink redaction, OTel/live Explorer/time travel are Open. |
| `S07` CLI/MCP | `PQG` | Relevant native lane; `INT`; `SRV` for mutation | CLI/MCP packages, Python CLI, docs | TS alpha command subset/read-only MCP exists; full dual-language operational surface is Partial. |
| `S08` production storage/workers | `INT` contract | Native lanes implement; `PQG` chaos | storage/worker packages and Python | Local JSONL/file slice exists; SQLite default, PostgreSQL/S3/workers are Open. |
| `S09` education/product parity | `PQG` | Both native lanes verify examples; `INT` claims | docs/examples/patterns/apps | Quickstart/four TS constructors/two examples exist; course, ten bundles, picker and galleries are Partial/Open. |
| `S10` governance/distribution | `INT` | `PQG`, package lanes, `SRV`, `EXT` where needed | root governance, workflows, release assets | Public MIT alpha/governance exist; trusted packages, provenance, external evidence and full support plan remain Partial/Open. |

## 6. Ten-pattern bundle ownership

`PQG` owns bundle assembly and user-facing coherence. `TSR` and `PYR` own their
native executable implementations. `INT` owns shared pattern semantics,
fixtures and the decision that the pattern bundle gate (`PB`) passed. Every row
requires YAML and JSON, TS and Python, deterministic mock E2E, expected events,
optional provider setup, diagram, budgets, permissions, failure/resume proof,
tests and Claude Code/Codex/MCP/shell guides.

| Pattern | Capability dependency owner(s) | Review pair | Current gap / next ownership action |
|---|---|---|---|
| `P01` Multi-source research diamond | `TSR`/`PYR` runtime; `PQG` bundle; `INT` reduction contract | Opposite runtime + `INT` | TS constructor/showcase is Partial; assign Python/YAML/JSON, resume, budgets, permissions and full PB evidence. |
| `P02` Cited deep research | `INT` verifier contract; native lanes; `PQG` citations/guides | Native cross-review + `INT` source-quality review | Open pending Day 11 verifier and Day 13 adapters. |
| `P03` Route-auth security sweep | `INT` router/policy; native lanes; `PQG` security harness | `SRV` + `INT` + opposite runtime | Open pending conditional routing, capabilities, isolation and security gate. |
| `P04` Diff-risk router/judge | `INT` quorum/verifier; native lanes; `PQG` demo | Opposite runtime + `INT` | Router constructor is Partial; runtime panels, retained votes/abstention and resume bundle are open. |
| `P05` Loop-until-dry discovery | `INT` cycle/budget; native lanes; `PQG` demo | Opposite runtime + `INT` | Static constructor is Partial; global seen set, convergence, hard exits and verifier are open. |
| `P06` File migration/worktrees | `INT` isolation/merge; native lanes; `PQG` migration UX | `SRV` + opposite runtime + `INT` | Open pending worktree leases, path policy, test gate, structured conflicts and recovery. |
| `P07` CI failure sweeper | Native retry/process/adapters; `PQG` fake CI bundle | Opposite runtime + `INT` | Open pending durable retry/process isolation/shell adapter and approval semantics. |
| `P08` Dependency update sweeper | Router/recovery/isolation/adapters; `PQG` dependency fixtures | `SRV` + `INT` | Open pending isolation, HTTP/shell and dependency/license policy. |
| `P09` PR babysitter | Router/durable waits/human gates/MCP; `PQG` fake PR harness | `SRV` + `INT` | Open pending stale approvals, idempotent writes, adapter/MCP policy and resume trace. |
| `P10` Scheduled ecosystem scan | Cycle/budget/recovery/provider/worker owners; `PQG` schedule bundle | Opposite runtime + `INT` | Open pending bounded schedules, providers, production worker/storage and partial-outage recovery. |

Ten directories on Day 14 satisfy only skeleton coverage. `PB` remains open for
each row until the complete bundle and cross-language E2E evidence are reviewed.

## 7. Handoff and integration protocol

### 7.1 Assignment packet

Before work starts, `INT` records:

1. task ID, objective, explicit non-goals and master-plan/gate references;
2. primary role/agent, `R1`/`R2`/`R3` reviewers and merge owner;
3. exact owned path set, branch/worktree and base revision;
4. frozen spec/fixture revision and any permitted local interface assumptions;
5. hard dependencies, scaffold-only dependencies and blocked external inputs;
6. expected artifacts, focused tests, shared conformance, docs and evidence IDs;
7. attempt/time/cost/fan-out bounds for agent or generated work; and
8. next integration window and heartbeat deadline.

No agent starts by broadening its scope to “whatever is needed.” A missing
contract, permission or shared-file change returns to `INT` as a dependency.

### 7.2 Implementation packet

The primary owner hands off:

- base and head revisions plus a complete changed/untracked file manifest;
- public behavior added, deliberately excluded behavior and compatibility risk;
- exact commands, tool versions, test counts/results and generated report paths;
- shared fixture IDs and normalized output when portable behavior changed;
- cancellation, cleanup, failure, resource-bound, mutation and negative-test
  coverage appropriate to the change;
- docs/example impact, security/capability impact and migration requirement;
- unresolved questions, flaky or opt-in tests and any external authority needed;
- confirmation that no unrelated user/agent changes were discarded or
  reformatted; and
- a suggested reviewer reproduction sequence that starts from a clean checkout
  or packed artifact when applicable.

“Tests pass” without the exact command and revision is not a handoff packet.

### 7.3 Review and merge sequence

1. The semantic reviewer reads the frozen contract and changed public behavior,
   then runs focused negative/adversarial tests. They do not infer correctness
   from the author’s summary.
2. The opposite runtime reviewer compares portable projections and reduces any
   mismatch to a shared fixture. Native implementation details may differ;
   contract fields may not.
3. `INT` verifies path ownership, dependency state, evidence completeness,
   backwards compatibility, docs claims and downstream reopen impact.
4. `PQG` runs relevant conformance, docs, package, matrix, benchmark or security
   collectors only after the semantic review is satisfied.
5. `INT` integrates in the scheduled window, resolves no semantic conflict by
   guesswork, and reruns affected joins from the integration revision.
6. The registry/log receives reviewed and merged evidence. “Completed” is used
   only when the whole task acceptance condition is met; otherwise the task is
   `in_progress`, `waiting`, `blocked` or a narrower successor is opened.

### 7.4 Conflict, stale work and reassignment

- On overlapping edits, both writers stop. `INT` identifies the authoritative
  owner, captures both manifests and chooses ordered application or a new
  worktree. No reset, checkout, overwrite or mass formatter resolves ownership.
- At 60 minutes without evidence the scanner warns; at 120 minutes without a
  heartbeat/artifact/test/commit it marks stale. Waiting on a registered hard
  dependency is not slowness.
- Reassignment records the old owner, blocker/staleness evidence, accepted
  artifacts, unsafe partial work and new lease. The new owner does not claim
  authorship or silently discard the prior diff.
- The same blocker in two scans escalates to `INT`. A blocker stays open until
  the missing authority/state changes; scanner liveness cannot clear it.

## 8. Evidence contract by lane

Every accepted evidence record contains source revision, spec revision/hash,
exact command, environment matrix, result, immutable report/artifact path,
date, independent reviewer and explicit exclusions.

| Lane | Minimum implementation evidence | Additional release evidence |
|---|---|---|
| `INT` | Reviewed contract/ADR, fixture manifest, dependency/gate mapping, both native conformance reports, downstream reopen analysis | Candidate coordinates, complete leaf-gate roll-up, signed go/no-go/fallback decision, package/image/SBOM/checksum/attestation identities |
| `TSR` | Focused Vitest, typecheck/lint/build, resource and cancellation tests, public export/API diff, shared conformance | Packed tarball clean install on Node 20/22 and supported OSes, upgrade, npm trusted-publishing rehearsal and provenance |
| `PYR` | Focused pytest, Ruff, strict mypy, build, resource/cancellation/cleanup tests, public export diff, shared conformance | Wheel and sdist clean installs on Python 3.11/3.12/3.13 and supported OSes, upgrade, PyPI trusted-publishing rehearsal and provenance |
| `PQG` | CLI subprocess envelopes, MCP denial/defaults, docs links/code samples, deterministic report repetition, UI smoke/accessibility, benchmark method and raw output | OS/version matrices, threat/fuzz/chaos reports, tester cohort, consented external assets, site/package link audit, launch/support manifests |
| `SRV`/`EXT` | Named scope, method, date, reviewed immutable revision, findings and disposition | Independent sign-off, consent/redaction where relevant; no credentials, raw prompts or user data in committed evidence |

Evidence must demonstrate the property, not merely artifact presence. Examples:

- a schema file is not canonical parity without both native projections;
- a task heartbeat is not completion;
- aggregate test count is not coverage, chaos or portability evidence;
- a mock UI is not runtime functionality;
- a package build is not a clean packed install or trusted publication;
- a maintainer-run Quickstart is not an external usability report; and
- stars are observed organic outcomes, never a technical gate or manufactured
  deliverable.

## 9. Current ownership and evidence gaps

These gaps must remain visible until superseded by accepted evidence:

1. **Registry-to-plan coverage:** the historical registry strongly covers the
   alpha slice and active pipeline work, but Days 8–21 and many control IDs need
   explicit primary/reviewer/path/evidence assignments. Every coverage-matrix
   control must be reconciled; a listed control is not proof that a live task
   exists.
2. **Reviewer provenance:** many existing registry entries name an implementer
   but no independent reviewer field or immutable review artifact. Prior code
   can remain useful, but affected public gates stay Partial until review is
   reconstructed against a named revision.
3. **Shared-contract serialization:** `INT` must remain the sole writer for
   specs/fixtures while native lanes implement in parallel. Current pipeline
   work still requires integrated review and final shared-gate evidence before
   it becomes Green.
4. **Unowned future package paths:** provider, isolation, policy, storage,
   worker and Explorer packages do not all exist. Their exact path and writer
   must be assigned before scaffolding to prevent overlapping “platform” and
   “runtime” interpretations.
5. **Required control documents:** competitor matrix, four architecture
   documents and three growth documents remain open according to the coverage
   matrix. Their future owners are `INT` for architecture/decision authority
   and `PQG` for research/growth drafts, with explicit single-file delegation.
6. **Cross-language completeness:** Python CLI, builders/YAML, complete
   router/barrier integration, cycles, budgets, verification, isolation,
   adapters, production stores and plugins remain unclosed. Neither native lane
   may be silently downgraded.
7. **Platform truthfulness:** trace viewer, Explorer, complete CLI/MCP, ten PB
   pattern bundles, course, site and galleries must consume real reviewed
   behavior or remain clearly mock/scaffold-only.
8. **Quantitative gates:** consolidated coverage, macOS/Windows matrices,
   accepted performance baselines, randomized failure campaign, complete
   security/license/secret evidence and pattern E2E are missing.
9. **External gates:** registry publishing identities, at least five external
   usability reports, 80% five-minute success, authentic adopter consent and
   hosted launch/support evidence require outside state or authority. They
   cannot be auto-completed by an agent.
10. **Release and popularity claims:** stable v1 remains blocked until every
    mandatory checklist row is Green. The 6,000+ Day-21 star number is an
    organic breakout target and 9,416+ is a moving benchmark—not an ownership
    task, guarantee or waiver for technical quality.

## 10. Post-audit primary ownership and write leases

The following lanes close the 16 omissions found by the full-plan audit. Each
row has one primary writer; named reviewers do not share that write lease.

| Task(s) | Primary | Exclusive write lease | Required independent review |
|---|---|---|---|
| `CTRL-RELEASE-MAP-074` | `INT` | `release-task-map.json`, mapping checker/tests | `PQG` verifies 178/178, blocking classification and negative fixtures. |
| `CTRL-EVIDENCE-BACKFILL-075` | `INT` | revalidation schema/overlay/checker | Release reviewer verifies candidate binding and exclusions. |
| `D17-USABILITY-076` | `PQG` | study method and redacted evidence manifests | `EXT` supplies authentic reports; privacy owner and `INT` review aggregation. |
| `D9-APPROVAL-077` | `INT` | approval spec and shared fixtures | `SRV` reviews authority/staleness; native implementers consume but do not edit fixtures. |
| `D14-NPM-DIST-078` | `TSR` | canonical distribution package and checker | `PQG` clean-installs; registry owner is an external gate only. |
| `D16-PRIVACY-079` | `PQG` | privacy/consent/retention docs and schemas | Human data owner plus `SRV` approve before collection. |
| `D18-SUPPORT-READINESS-080` | `INT` | support/incident runbooks and readiness manifest | `PQG` tabletop; `SRV` support-bundle review; roster owners acknowledge. |
| `D13-TS-ADAPTERS-081` | `TSR` | TypeScript adapter package/tests | `INT/PQG` consume results at `049`; no fixture write. |
| `D13-PY-ADAPTERS-082` | `PYR` | Python adapter package/tests | `INT/PQG` consume results at `049`; no fixture write. |
| `D18-EDUCATION-ASSETS-083` | `PQG` | course/case/demo manifests and assets | Domain maintainers run snippets; external stories require consent. |
| `D8-RUNTIME-CHAOS-084` | `PQG` | runtime chaos corpus/report | `TSR/PYR` review native leak or accounting findings independently. |
| `D9-OPS-CONTROL-085` | `PQG` | operational CLI acceptance/docs | Platform implementers supply commands; `INT` owns envelope join. |
| `CTRL-RELEASE-ROLLUP-086` | `INT` | roll-up engine, blocker manifest, decision record | Distinct R3 release/security reviewers sign; publisher acts only afterward. |
| `D9-TS-REDACTION-087` | `TSR` | TS redaction/persistence/runtime tests | `SRV/PQG` attack sinks at `089`. |
| `D9-PY-REDACTION-088` | `PYR` | Python redaction/persistence/runtime tests | `SRV/PQG` attack sinks at `089`. |
| `D9-REDACTION-CONFORMANCE-089` | `INT` | shared redaction fixtures and parity report | `PQG` owns canary scanner; `SRV` provides independent R3 disposition. |

Current active leases are disjoint: `INT` owns shared D2 protocol/fixtures and
registry integration, the TypeScript lane owns only TypeScript authoring files,
the Python lane owns only Python authoring files, and the redaction protocol lane
owns only `spec/redaction-semantics.md`. No active lane may modify another
lane's shared expected-output file.

## 11. Assignment readiness checklist

`INT` may dispatch a new work package only when every answer is yes:

- Is its master-plan day, dependency node, capability/pattern row and release
  gate identified?
- Are hard dependencies accepted, or is the work explicitly scaffold-only?
- Is one primary owner named with a non-overlapping path lease?
- Are the semantic and integration reviewers named at the correct review level?
- Is the canonical spec/fixture revision frozen and readable?
- Are exact positive, negative, cancellation, cleanup, resource and parity
  tests specified in proportion to risk?
- Are docs, examples, package and security impacts assigned rather than left as
  “later” work?
- Is the evidence destination and integration window known?
- Are external permissions and non-goals explicit?
- Will a failed gate remain failed rather than being hidden by a mock, null,
  retry, relaxed bound, unsupported claim or premature release label?

If any answer is no, `INT` records the dependency or blocker and assigns only
independent work that does not consume the missing contract.
