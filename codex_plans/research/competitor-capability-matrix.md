# Graph Engineering competitor capability matrix

Snapshot date: **2026-07-26**

This matrix compares Graph Engineering with Loop Engineering and two
representative runtime references already named by the local research corpus:
LangGraph as an agent-graph/persistence comparator, and Temporal as a durable
execution comparator. Temporal is not presented as an agent-graph product, and
Loop Engineering is primarily a methodology/toolchain benchmark rather than a
like-for-like runtime.

No internet refresh was performed for this document. Unknown is an intentional
result, not an invitation to infer absence. Before publishing a competitive
claim, re-audit the named version and official primary source and record the
date.

## 1. Sources and evidence policy

Local authorities:

- [21-day master plan](../Graph-Engineering-21-Day-Master-Plan.md)
- [Loop Engineering benchmark snapshot](loop-engineering-benchmark.md)
- [Graph Engineering source review](graph-engineering-source-review.md)
- [current implementation coverage](../delivery/master-plan-coverage-matrix.md)
- [stable-v1 release checklist](../delivery/release-checklist.md)

Selected current-repository evidence:

- [Graph IR schema](../../spec/graph.schema.json) and
  [runtime semantics](../../spec/runtime-semantics.md)
- [pipeline contract](../../spec/pipeline-semantics.md),
  [TypeScript pipeline](../../packages/runtime/src/pipeline.ts), and
  [Python pipeline](../../python/src/graph_engineering/pipeline.py)
- [durable recovery contract](../../spec/durable-recovery-semantics.md),
  [TypeScript durable runtime](../../packages/runtime/src/durable.ts), and
  [Python durable runtime](../../python/src/graph_engineering/durable.py)
- [TypeScript CLI](../../packages/cli/src/cli.ts),
  [read-only MCP server](../../packages/mcp-server/src/server.ts), and
  [pattern constructors](../../packages/patterns/src/patterns.ts)
- [Quickstart](../../docs/QUICKSTART.md),
  [failure modes](../../docs/FAILURE_MODES.md), and
  [security boundary](../../docs/SECURITY.md)

### Evidence labels

| Label | Meaning | Permitted wording |
|---|---|---|
| `V` | Verified by the local repository or dated local benchmark | “Present in the cited snapshot/revision.” This is not automatically stable-release evidence. |
| `S` | A useful verified slice exists, but the promised surface is broader | “Partial” or “available for the named scope,” with the missing scope stated. |
| `P` | Planned in the master plan but not evidenced as implemented | “Planned,” never “ships,” “supports,” or “complete.” |
| `R` | An official external reference is listed locally, but its contents/version were not captured for this audit | “Reference identified; capability not audited here.” |
| `U` | No adequate local evidence | “Unknown.” Absence of evidence is not evidence that the competitor lacks it. |
| `N/A` | The row is not a sensible like-for-like claim for that comparator | Explain the category difference instead of assigning a winner. |

Graph Engineering `V` and `S` labels describe the current repository snapshot,
not a published stable package. The release checklist remains Open until its
candidate-bound evidence slots are filled.

## 2. Comparator scope

| Comparator | Locally supported product interpretation | Evidence boundary in this document |
|---|---|---|
| **Graph Engineering** | Vendor-neutral, dual-language graph orchestration runtime plus CLI/MCP/patterns/docs; full 21-day platform is the target | Repository files and coverage matrix support current-state claims; all future scope remains `P` or `U` |
| **Loop Engineering** | Methodology and toolchain with a strong concept, CLI/DX, content, safety guidance and community flywheel; it points users to companion projects for a general runtime | Dated local benchmark of its public repository; no fresh inspection and no inference about undocumented companion behavior |
| **LangGraph** | Representative agent-graph persistence comparator because its official persistence documentation is linked in the source review | `R` only for the existence of the persistence reference; detailed current capabilities, editions, languages, limits, DX and popularity are `U` here |
| **Temporal** | Representative durable-execution comparator because its official durable execution documentation is linked in the source review | `R` only for the durable-execution reference; agent-graph-specific and current product/community details are `U` or `N/A` here |

## 3. Runtime and orchestration capability matrix

| Capability | Graph Engineering | Loop Engineering | LangGraph | Temporal |
|---|---|---|---|---|
| Versioned language-neutral graph contract | `V/S` JSON Schema Graph IR and canonical protocol exist; full node kinds, typed ports, nested graphs and policy validation are Partial | `U` Not established by the local benchmark; the benchmark characterizes a methodology/toolchain | `U` No local audited contract snapshot | `N/A/U` Durable workflow comparator; no local agent-graph contract audit |
| Native TypeScript runtime | `V/S` Deterministic DAG, pipeline and local durable slices exist | `U` General runtime behavior is not evidenced locally; benchmark says companion projects are used | `U` | `U` |
| Native Python runtime | `V/S` Native compiler/scheduler/pipeline/local durable slices exist; Python is not a TS client | `U` | `R/U` Persistence reference is specifically a Python documentation URL, but no capability audit was captured | `U` |
| Canonical cross-language bytes/hashes | `V/S` Shared compiler/runtime fixtures and canonical hashes exist for the current slice | `U` | `U` | `U` |
| Deterministic DAG/diamond scheduling | `V/S` Native ready-queue schedulers and diamond parity exist; scale and all node kinds remain open | `U` | `U` | `U` |
| Typed data edges and port/schema checks | `S/P` Endpoint/schema foundations exist; complete port compatibility, mapping, reducers and stream/artifact lowering are planned | `U` The local benchmark does not establish a runtime edge contract | `U` | `N/A/U` Not audited as an agent graph |
| Bounded fan-out/fan-in | `S` Ready-queue bounds and pattern constructors exist; complete dynamic fan-out policy is planned | `U` | `U` | `U` |
| Per-item streaming pipeline/backpressure | `V/S` Standalone bounded TS/Python APIs and shared cases exist; Graph IR `stream` edges and durable item queues are explicitly not activated | `U` | `U` | `U` |
| Barrier and quorum semantics | `S` Pure all/minimum/percentage evaluators exist; scheduler deadline/quorum/missing-state behavior is planned | `U` | `U` | `U` |
| Conditional routing and replay | `S/P` Pure single/multicast selection exists; scheduler conditional edges, confidence escalation and durable decision replay are planned | `U` | `U` | `U` |
| Bounded convergent cycles | `P` Static constructor exists, but executable `untilDry`, global seen set, semantic convergence and all hard exits are not complete | `U` | `U` | `U` |
| Dynamic checked graph revisions | `P` GraphPatch revision, permission, budget and malicious-patch gates are planned | `U` | `U` | `U` |
| Verifier/judge/reflection runtime | `P` Declarative verified-fanout constructor exists; votes, citations, rubrics, abstention/unknown and human gates remain open | `U` | `U` | `N/A/U` Not audited as an agent-verification system |
| Structured terminal failures | `V/S` Scheduler and pipeline failures, retries, timeouts, cancellation and upstream isolation exist for current slices | `V` Failure/safety guidance is a benchmarked product strength; runtime enforcement is `U` | `U` | `U` |
| Durable node results and resume | `V/S` Event-sourced immutable local-DAG start/resume and terminal idempotence exist | `U` Benchmark says a general runtime is delegated to companion projects | `R/U` Official persistence reference identified; exact semantics not audited | `R/U` Official durable execution reference identified; exact semantics not audited |
| Leases, replay, fork and approvals | `P` Full LockManager, dual-resume, replay/fork, stale approval and non-idempotent confirmation remain planned | `U` | `U` | `R/U` Durable execution is the comparator category, but these exact features were not locally audited |
| SQLite/PostgreSQL/S3 and worker mode | `P` Local event/checkpoint implementations exist; planned default/production stores and workers are not complete | `U` | `U` | `U` |
| External effects contract | `V/P` Repository invariant says at-least-once with idempotency/approval; complete runtime policy/approval enforcement remains planned | `U` Guidance may exist, but exact semantics are not established by the benchmark | `U` | `U` |
| Hard token/money/time/node budgets | `P/S` Narrow concurrency/attempt limits exist; atomic reservations, model usage/pricing and full hard budgets are planned | `V/U` Budget guidance is benchmarked; enforceable runtime behavior is unknown | `U` | `U` |
| Provider/model routing | `P` Deterministic local mock exists; official provider adapters/model tiers are planned | `U` Tool-aware starters are verified, but provider runtime conformance is unknown | `U` | `N/A/U` Not audited as a model-routing product |

## 4. Product and developer-experience matrix

| Product/DX surface | Graph Engineering | Loop Engineering | LangGraph | Temporal |
|---|---|---|---|---|
| Memorable, repeatable concept | `S` “Prompts describe work; loops repeat; graphs branch, verify, remember and converge” is defined; market validation is unknown | `V` A memorable concept and short explanation are benchmarked strengths | `U` | `U` |
| One CLI front door | `S` TS `init/validate/compile/plan/doctor/visualize` subset exists; Python CLI and full operational surface are open | `V` Unified CLI is benchmarked | `U` | `U` |
| Quickstart in at most three commands | `V/S` Local Quickstart meets command-count intent; external five-minute completion evidence is absent | `V` Five-minute onboarding is a benchmarked product strength | `U` | `U` |
| Doctor, readiness score and badge | `S/P` Doctor exists; complete G0–G4 score, top-three remediation and badge are planned | `V` Doctor, readiness score and badge are benchmarked | `U` | `U` |
| MCP and agent-harness entry points | `S/P` Read-only validation/planning MCP exists; runtime mutation policy and documented Claude Code/Codex/generic integrations are planned | `V` Tool-aware starters for multiple agent harnesses are benchmarked | `U` | `N/A/U` No local agent-harness audit |
| Executable patterns/starters/examples | `S` Four TS constructors and provider-free examples exist; ten complete YAML/JSON/TS/Python bundles are open | `V` Extensive patterns, starters and examples are benchmarked | `U` | `U` |
| Fourteen-step executable course | `P` Course topics and acceptance are planned; complete runnable course is absent | `V/S` Large educational/content surface is verified, not necessarily this exact course | `U` | `U` |
| Failure, safety and operations guidance | `V/S` Concepts, failure and security-boundary docs exist; complete operations/threat evidence is open | `V` Safety, failure, budget, state, worktree and operating guidance are benchmarked | `U` | `U` |
| Runtime visualization | `S/P` Deterministic Mermaid/DOT exists; live Explorer, critical path, utilization and replay/fork time travel are planned | `V` Interactive showcase is benchmarked; exact runtime trace depth is not locally audited | `U` | `U` |
| Stable machine-readable envelopes | `S` TS CLI and runtime envelopes exist for the current slice; full commands and dual-language CLI reference are open | `U` | `U` | `U` |
| Mock-first, credential-free normal CI | `V/S` Current examples/runtime use deterministic local execution; complete provider CI policy is planned | `U` | `U` | `U` |
| Package distribution | `S/P` npm workspace and Python build artifacts exist locally; trusted npm/PyPI stable publication is not evidenced | `V/S` Thirteen package manifests are recorded; package quality/publication details were not re-audited here | `U` | `U` |
| Interactive site, trace/adopter galleries | `P` Planned and evidence/consent-gated | `V` Interactive showcase and contributor recognition are benchmarked; exact gallery scope is not re-audited | `U` | `U` |
| English and Chinese launch material | `P` English canonical plus Chinese launch/Quickstart parity is planned | `U` | `U` | `U` |

## 5. Safety, security and operational-control matrix

| Control | Graph Engineering | Loop Engineering | LangGraph | Temporal |
|---|---|---|---|---|
| No implicit cycles or unbounded retries/fan-out | `S/P` Compiler and runtime bounds cover current slices; dynamic cycles/fan-out and randomized proof remain open | `V/U` Safety/budget guidance is verified; enforcement is unknown | `U` | `U` |
| Failures never silently become null | `V/S` Repository invariant and current native structured results support this for implemented slices | `U` | `U` | `U` |
| Cancellation and cleanup | `V/S` Native scheduler/pipeline adversarial suites exist; future providers/tools/stores still need conformance | `U` | `U` | `U` |
| Deny-by-default tool/fs/network/secret capabilities | `P` Required by plan; current docs state ambient-authority limitations and enforcement is open | `V/U` Safety/worktree guidance is verified; runtime authority enforcement is unknown | `U` | `U` |
| Worktree/process/container isolation | `P` Planned leases, path policy, namespaces and tested merge node are absent | `V/U` Worktree guidance is benchmarked; enforced isolation is unknown | `U` | `U` |
| Planner cannot expand authority | `P` Normative invariant; enforcement/adversarial proof remain open | `U` | `U` | `N/A/U` Not locally audited in agent-planner terms |
| Prompt-injection resistance | `P` Capability-denial and adversarial suite planned | `U` | `U` | `N/A/U` |
| Secret redaction | `P/S` Security docs exist; end-to-end redaction evidence across errors/events/traces/prompts/tools is open | `U` | `U` | `U` |
| Telemetry and prompt capture off by default | `V/P` Fixed product invariant; clean packed-install/network evidence and OTel implementation remain open | `U` | `U` | `U` |
| Crash/dual-resume/chaos evidence | `S/P` Local crash-window slice exists; leases, store/artifact/network chaos and 100 randomized runs are open | `U` | `R/U` Persistence reference only | `R/U` Durable execution reference only |
| Supply-chain CI | `V/S` CodeQL, dependency review and Dependabot exist; full secret/license/SBOM/attestation evidence is open | `V/S` Nineteen workflows are recorded; their exact security coverage was not locally classified | `U` | `U` |
| Trusted publishing and provenance | `P/External` Local package rehearsals exist; registry identities, checksums, SBOM and attestations are open | `U` | `U` | `U` |
| Human approval for risky external effects | `P` Required by contract/release plan; runtime approval and stale-approval behavior remain open | `U` | `U` | `U` |

## 6. Community and market-surface matrix

| Community/market signal | Graph Engineering | Loop Engineering | LangGraph | Temporal |
|---|---|---|---|---|
| Public repository | `V` Public `reacher-z/GraphEngineering` repository and source alpha are recorded | `V` Public benchmark repository | `R/U` Official documentation link exists; repository metrics not captured | `R/U` Official documentation link exists; repository metrics not captured |
| Dated star/fork evidence | `U` No current Graph Engineering star/fork snapshot is stored in the required local sources | `V` 9,416 stars, 1,290 forks and 60 watchers at the 2026-07-26 benchmark snapshot | `U` Do not guess | `U` Do not guess |
| Repository/content scale | `S` Multi-package dual-language alpha with docs/examples/governance; full planned surface is incomplete | `V` Roughly 599 files, about 40k core text/code lines, thirteen package manifests and nineteen workflows in the snapshot | `U` | `U` |
| Governance/contribution entry points | `V/S` MIT, issue/PR templates, Discussions/security pathways exist; external contribution outcomes are unknown | `V` Good-first-issue inventory, contribution automation and recognition are benchmarked | `U` | `U` |
| Authentic adopters | `U/External` No accepted ten-adopter evidence in the local plan corpus | `U` Not quantified by the local benchmark | `U` | `U` |
| Outside contributors/PRs | `U/External` Controlled goals exist; current accepted counts are not stored here | `U` Not quantified in the local benchmark | `U` | `U` |
| Retained usage/successful runs | `U/External` Measurement is planned; accepted baseline is absent | `U` Star awareness is explicitly not treated as retention evidence | `U` | `U` |
| Launch/content flywheel | `P/S` Public alpha and source materials exist; complete course/site/case/channel calendar remains open | `V` Effective community/content flywheel is a benchmarked strength | `U` | `U` |
| Organic-growth guardrails | `V` Plan prohibits paid/fake/bot/mutual-star schemes and separates stars from release quality | `U` No claim made by this local audit | `U` | `U` |

## 7. What Graph Engineering may claim today

Evidence-supported positioning:

- Graph Engineering is building a native TypeScript and Python graph runtime
  around a language-neutral schema and shared conformance fixtures.
- The current repository contains deterministic DAG execution, standalone
  bounded pipelines, pure route/barrier evaluators, structured failures and a
  meaningful local event-sourced recovery slice.
- It also contains an early TS CLI, a read-only MCP server, deterministic
  visualization, provider-free examples and honest security/failure-boundary
  documentation.
- Loop Engineering is the product-surface benchmark: Graph Engineering still
  needs to match its onboarding, tools, content, safety guidance and community
  flywheel while completing the runtime advantages promised by the plan.

Claims that remain prohibited until their gates are Green:

- “Complete graph platform,” “production-ready,” “battle-tested,” or
  “production proven.”
- Full replay/fork, distributed leases/workers, exactly-once external effects,
  enforced isolation, official provider parity, complete verifier panels or
  durable per-item stream recovery.
- Technical superiority over LangGraph or Temporal; the local evidence only
  records links to their persistence/durability documentation.
- Popularity parity, 6,000 stars, retained adoption or community leadership
  without a timestamped public measurement.

## 8. Differentiation thesis and proof obligations

| Intended differentiation | Proof required before public “better” wording | Current state |
|---|---|---|
| Real runtime rather than methodology alone | Packed dual-language runtime, complete public API, deterministic examples and independent user success | Partial |
| Typed, versioned data edges | Full port/schema/mapping/reducer validation and canonical migration/version evidence | Partial/Open |
| Native TS/Python parity | `X01-X10` candidate-bound conformance with no divergence | Partial |
| Wider execution without false barriers | Pipeline/backpressure, 100-way concurrency, 1,000-node bounds and reproducible latency topology benchmarks | Partial/Open |
| Durable recovery and memory | Complete leases/checkpoints/artifacts/resume/replay/fork/crash-race evidence | Partial/Open |
| Confidence through verification | Pass/reject/abstain, citation, diverse panel, retained votes, unknown/human gate and isolated evidence | Open |
| Safe self-routing and dynamic revisions | Malicious-patch, authority, budget, fan-out/depth/node/attempt and dry-run tests | Open |
| Isolation for parallel writers | Worktree/process/container escape, conflict, cleanup and merge-gate tests | Open |
| Cost-aware topology/model tiering | Versioned pricing/usage, atomic reservations and hard-stop-before-schedule tests | Open |
| Runtime Explorer/time travel | Real-event topology, critical path/utilization/waits/retries/verdicts and replay/fork UI tests | Open |
| Better open-source activation | External five-minute success, retained-run and contribution evidence; no manufactured growth | Open/External |

The defensible strategy is therefore “match the product surface, prove the
runtime differences,” not “declare every unknown competitor cell absent.”

## 9. Controllable leading indicators

The plan contains both inputs the team controls and outcomes it can only
influence. They must not be mixed when explaining progress.

### Directly controllable inputs and quality gates

| Indicator | Target/control | Owner | Evidence | Correct response when missed |
|---|---|---|---|---|
| Quickstart command count | No more than three user commands | `PQG` | Published revision plus independent command-count review | Remove steps or automate setup before promotion |
| Deterministic first run | Mock-first, no provider credential or product telemetry opt-in | Native lanes + `PQG` | Clean-machine network/credential/config transcript | Fix packaging/defaults; do not blame provider setup |
| First-success usability method | Recruit and time a real cohort with reproducible instructions | `PQG` + `EXT` | Sampling notes, anonymized results and issue links | Iterate onboarding and repeat the cohort |
| Cross-language parity | Every applicable `X01-X10` row Green | `INT`, `TSR`, `PYR` | Shared fixture revision and both reports | Freeze the divergent feature and reduce to a shared case |
| Safety/recovery/provenance | All mandatory release rows Green | `INT`/`SRV` | Candidate-bound checklist leaf evidence | Stay RC; never relax the label |
| Ten complete pattern bundles | All PB elements, not just directories | `PQG` plus native lanes | Per-pattern artifact/test/guide manifest | Keep incomplete pattern labeled skeleton/experimental |
| Fourteen-step executable course | Fourteen runnable checks plus “when not to use a graph” | `PQG` | Course manifest, docs and execution report | Close missing runtime/example dependency first |
| Content/release assets | Required evidence-backed beats and channel variants prepared | `PQG` | Asset manifest, current links/version and claim audit | Delay the unsupported beat or narrow its claim |
| Maintainer response time | Controlled p50 goal below twelve hours | `PQG`/support rota | Timestamped queue snapshot and metric definition | Reallocate triage/support capacity |
| Personalized trial invitations | Ten relevant, individualized invitations | `PQG` | Consent-respecting outreach log without private message content | Improve targeting/message; never mass-spam |

### Influenceable adoption outcomes

| Outcome | Plan goal | Guarantee status | Interpretation |
|---|---:|---|---|
| CLI downloads | 2,000 | Not guaranteed | Useful awareness/activation signal; validate successful use rather than counting installs alone |
| Successful or self-reported graph runs | 500 | Not guaranteed | More meaningful than stars, but instrumentation/definition must be privacy-safe and stable |
| Seven-day retained repositories | Track as north-star | Not guaranteed | Indicates recurring value; define cohort and avoid telemetry by default |
| Public adopters | 10 | Not guaranteed | Count only authentic public/consented evidence |
| Outside contributors | 10 | Not guaranteed | Separate maintainers, automation and outside people |
| External PRs | 25 | Not guaranteed | Report opened, merged and rejected states honestly |
| Organic stars | Day 7: 300; Day 13: 1,000; Day 17: 2,000; Day 21: 6,000+ stretch | Explicitly not guaranteed | Awareness outcome only; never a stable-release gate or substitute for activation/retention |

## 10. The 6,000-star and popularity-parity boundary

1. **6,000+ is a breakout OKR, not an engineering acceptance condition.** Code,
   plans, content and outreach can improve the probability; no agent can promise
   that independent GitHub users will star the repository.
2. **The dated Loop Engineering benchmark is 9,416 stars and 1,290 forks on
   2026-07-26.** It is a moving long-term popularity benchmark, not a number to
   silently reuse as current. Refresh only from a timestamped source when
   browsing is explicitly in scope.
3. **Stable v1 does not depend on stars.** It depends on recovery, security,
   cross-language conformance, provenance, usability and all mandatory release
   gates. Missing stars never permits a false release claim; excess stars never
   waive a failed gate.
4. **Growth must remain organic.** Paid/fake stars, bots, mutual-star schemes,
   fake adopters, fake testimonials and undisclosed promotion are forbidden.
5. **Report the funnel, not only the vanity number.** Visits, stars, installs,
   successful runs, retention, adopters, contributors and response time need
   stable definitions and timestamped evidence.
6. **Use misses diagnostically:** high visits with low stars triggers
   positioning work; stars without installs triggers Quickstart/package work;
   installs without successful runs pauses promotion for reliability; runs
   without retention triggers use-case and product-value work.

## 11. Required follow-up competitor audit

This document deliberately leaves most LangGraph and Temporal cells Unknown.
Before an external comparison, create a versioned, primary-source-only audit
that records:

- product/version/date and open-source versus hosted boundary;
- supported languages and install/package coordinates;
- graph/workflow contract, streaming, routing, cycles and dynamic-revision
  semantics;
- persistence, checkpoint, replay/fork, lease and external-effect semantics;
- provider/tool interfaces, budgets, cancellation and failure envelopes;
- isolation, capabilities, telemetry/redaction and supply-chain posture;
- CLI, local-first Quickstart, visualization, docs and pattern surface;
- license, governance, contributor/adoption evidence and dated public metrics;
- reproducible examples or tests for every comparative technical claim; and
- explicit Unknown cells where official evidence is unavailable.

Until that audit exists, LangGraph and Temporal are architectural references,
not defeated competitors, and Graph Engineering’s differentiation remains a
set of proof obligations.
