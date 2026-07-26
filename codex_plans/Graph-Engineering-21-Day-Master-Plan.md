# Graph Engineering: 21-Day Dual-Language Open-Source Platform Plan

Status: **Approved and executing — source alpha 1 released; durable recovery, bounded pipeline, D2 authoring, and the initial native Python CLI delivered; D7 cycle and D9 redaction contracts in progress**
Started: **2026-07-26**
Repository: <https://github.com/reacher-z/GraphEngineering> (public)
Current release: <https://github.com/reacher-z/GraphEngineering/releases/tag/v0.1.0-alpha.1>
Primary objective: ship a trustworthy Graph Engineering platform and create the product and launch conditions for a **6,000+ GitHub stars breakout target**.

## 1. Mission and success definition

Graph Engineering is a vendor-neutral, durable, observable multi-agent graph orchestration platform. Prompts describe work, loops repeat work, and graphs define how work branches, verifies, remembers, and converges.

The 21-day product includes:

- Native TypeScript/Node 20+ runtime, SDK, and CLI.
- Native Python 3.11+ runtime, SDK, and CLI.
- One language-neutral Graph IR, JSON Schema contract, event protocol, and cross-language conformance suite.
- DAGs, dynamic graph patches, parallel fan-out/fan-in, pipelines, barriers, routers, subgraphs, verifier panels, bounded convergent cycles, and human gates.
- Checkpoints, resume, replay, fork, shared durable state, and content-addressed artifacts.
- Provider/model routing, budgets, cost tracking, retry, rate limiting, cancellation, and circuit breakers.
- Worktree/process/container isolation, capability policies, secret redaction, and safe merge gates.
- OpenTelemetry, JSONL events, live status, critical-path metrics, and a Web Graph Explorer.
- MCP server, scaffolding, doctor, Graph Ready Score, badges, executable patterns, documentation, examples, and launch assets.
- Open-source governance, trusted package publishing, supply-chain security, contributor pathways, and a purely organic growth program.

### Benchmark

As of the 2026-07-26 launch-readiness rescan, `cobusgreyling/loop-engineering` has 9,416 stars and 1,290 forks, with a unified CLI, thirteen npm tools, nineteen workflows, extensive patterns/starters/examples, safety material, and an effective community/content flywheel. Graph Engineering must match that complete product surface while exceeding it technically with a real graph runtime, typed edges, durable recovery, dynamic graph revisions, cross-language parity, and runtime visualization.

The Day-21 6,000-star number is a breakout growth OKR, not an engineering guarantee. Long-term popularity parity tracks the moving benchmark, currently 9,416+ and still changing. No paid stars, bots, mutual-star schemes, fake adopters, or undisclosed promotion are permitted.

### Release rule

Day 21 must produce all planned assets and at least a complete beta/release candidate. Stable v1 ships only if recovery, security, cross-language conformance, package provenance, and external usability gates pass. Quality takes precedence over falsely labeling an incomplete build as production-ready.

### Live execution checkpoint — 2026-07-26

This checkpoint is append-only evidence of plan execution; it does not remove
or weaken any later-day acceptance gate.

| Plan area | State | Evidence / next gate |
|---|---|---|
| Day 1-4 foundations | Partial; current alpha slice green | Public source alpha, canonical IR/compiler, deterministic ready-queue schedulers, native TS/Python parity, read-only MCP, security checks, and package rehearsal are green. Commit `dd8c0f7` adds strict JSON/bounded safe YAML, declaration-ordered TS/Python builders, strict typed ports, initial component/revision identity, exact cross-language binary64 rendering, and the native Python `graph`/`grapheng` CLI. Trace/subgraph/reducer/artifact execution and later operational commands remain open. |
| Day 5 barriers and routing primitives | Partial | Settled all/minimum/percentage barriers and deterministic single/multicast routing have shared pure-evaluator parity; scheduler-integrated waiting, deadlines/quorum, conditional edge execution, and durable route replay remain open. |
| Day 5 pipeline/backpressure | Delivered for the standalone native scope | Commit `3df201d` provides lazy bounded TypeScript/Python pipelines, backpressure, ordered/completion delivery, stop/drop/dead-letter policies, cancellation/cleanup, a hard 2,048-stage construction bound, 8 shared cases, 115 TS runtime tests and 59 Python pipeline tests. Graph IR stream-edge lowering and durable item recovery remain separate open scope. |
| Day 6 failure envelopes | Partially complete | Scheduler failures, retry/timeout/cancellation, upstream isolation, invalid input/output, and attempt budgets are structured; pipeline terminal/run failures are the active parity slice. |
| Day 9 durable execution | Delivered for immutable local DAG scope | Commit-before-release event-sourced start/resume, exact tagged binary64 JSON, crash-window handling, terminal idempotence, and bidirectional terminal-history interop are in draft PR #14. Leases, checkpoint acceleration, replay/fork, approvals, and distributed stores remain explicit follow-ups. |
| Release/growth | Active; control plane delivered, candidate still absent | Public repository and `v0.1.0-alpha.1` exist; protected main and CI/CodeQL are green. Commit `105881f` freezes the 178/178 semantic release map and fail-closed evidence protocol, but the canonical overlay intentionally remains empty at `0/93` release weight and every blocking release row remains Open. The controlled objective remains trustworthy activation/adoption; 6,000+ organic stars is a breakout OKR, not a manufactured or guaranteed result. |

Current critical path after the pipeline milestone is: bounded convergent cycles
and their hard budgets; cost/model routing; verifier/judge/reflection semantics;
then worktree/process isolation and provider adapters. Completed work is not
counted as evidence for excluded functionality merely because it landed ahead
of its calendar day.

Two independent full-plan audits on 2026-07-26 found that the registry covered
only the implemented alpha slice through the active pipeline work. Days 8-21,
ten complete patterns, and most hard release thresholds were not yet represented
as executable tasks. Therefore “healthy” scanner output is a liveness/artifact
signal only and must not be read as master-plan completion. The canonical
coverage matrix and dependency backlog under `codex_plans/delivery/` must stay
synchronized until every row is evidence-backed; missing external adoption or
publishing authority remains an explicit gate rather than an inferred success.

Superseding execution update: the registry now contains 107 concrete controls
covering the entire calendar, every runtime lane, all ten pattern bundles,
mandatory acceptance evidence, documentation, provenance, privacy, support,
release-leaf mapping, historical candidate revalidation, and organic growth.
The delivery directory now contains a day-by-day coverage matrix, a dependency
graph, an ownership/write-lease map, and a 178-item release checklist. Planned,
waiting, and external-gate rows remain visibly non-complete; this expansion fixes
the scanner's former scope blind spot but does not itself satisfy any product or
release gate.

The 107-task checkpoint incorporates the full-plan gap audit's 16 missing
controls (`074`-`089`): independent TS/Python adapter and redaction lanes,
approval authority, runtime chaos versus durable operations, privacy/usability,
education/support readiness, canonical npm distribution, release-leaf mapping,
candidate evidence backfill, and a final fail-closed release roll-up. The task
graph is unique, has no dangling dependency and is acyclic. At the
registry-expansion checkpoint the scanner reported completed pipeline evidence
as 6 of 77 required gates satisfied. That number is historical: the
timer-backed live scan and immutable task evidence are authoritative as later
milestones close. Planned and external outcomes remain open until their own
evidence contracts pass.

## 2. Planning, logs, and agent operations

This file is the canonical plan. Supporting execution documents live below `codex_plans/`, while evidence and progress live below `codex_logs/`.

Planned support documents:

```text
codex_plans/
├── Graph-Engineering-21-Day-Master-Plan.md
├── research/
│   ├── loop-engineering-benchmark.md
│   ├── graph-engineering-source-review.md
│   └── competitor-capability-matrix.md
├── architecture/
│   ├── graph-ir-and-schema.md
│   ├── runtime-semantics.md
│   ├── persistence-and-recovery.md
│   ├── security-and-isolation.md
│   └── cross-language-conformance.md
├── delivery/
│   ├── task-dependency-graph.md
│   ├── agent-ownership-map.md
│   └── release-checklist.md
└── growth/
    ├── launch-plan.md
    ├── content-calendar.md
    └── metrics-and-experiments.md
```

Development logs:

```text
codex_logs/
├── README.md
├── task-registry.json
├── runs/YYYY-MM-DD/<run-id>.jsonl
├── agents/<agent-id>.jsonl
├── scans/<timestamp>.json
├── nudges/queue.jsonl
├── decisions/ADR-xxxx.md
├── daily/YYYY-MM-DD.md
└── incidents/<incident-id>.md
```

Logs are append-only. Corrections use a superseding event. Required events are assigned, started, heartbeat, decision, tool, test, blocked, reviewed, merged, and released. Raw prompts, model responses, credentials, authorization headers, and user data are never stored by default. Raw run and agent logs remain local; sanitized daily summaries and ADRs may be committed.

### Thirty-minute progress scanner

`tools/progress-scanner` provides `scan`, `status`, `install-timer`, `uninstall-timer`, and `acknowledge`. Every scan:

1. Resolves and validates the fixed repository root and obtains a non-reentrant file lock.
2. Reads the task registry, agent heartbeats, dependency state, commits, artifacts, and test evidence.
3. Classifies work as healthy, waiting-dependency, stale, blocked, or integration-risk.
4. Atomically writes a scan snapshot and queues evidence-backed nudges.
5. Lets the active main agent send collaboration messages; the scanner never fabricates access to an undocumented agent-control API.

Waiting on registered dependencies is not slow. Sixty minutes without evidence is a warning; 120 minutes without a heartbeat, commit, test, or artifact is stale. The same blocker in two scans escalates. Nudges are rate-limited to one per task every two hours. The scanner cannot kill processes, edit code, merge, or reassign work.

### Maximum useful concurrency

- Main agent: architecture, canonical schemas, integration, review, risks, and releases.
- Agent A: TypeScript runtime, SDK, and Node adapters.
- Agent B: Python runtime, SDK, and Python adapters.
- Agent C: CLI, Explorer, MCP, docs, examples, QA, and launch assets according to the current critical path.

Each agent owns one active work package and a separate worktree/branch for concurrent writes. Shared schemas and conformance fixtures are main-agent-owned. There are two daily integration windows. Implementers cannot be their only reviewer.

## 3. Repository architecture and public contracts

### Technology choices

- pnpm workspace for TypeScript packages; uv workspace for Python packages.
- TypeScript strict mode, Node 20/22, Vitest.
- Python 3.11-3.13, Pydantic v2, pytest, Ruff, mypy.
- React/TypeScript/Vite Graph Explorer.
- JSON Schema 2020-12 as the persistent contract.
- SQLite plus a content-addressed local artifact directory by default.
- PostgreSQL plus an S3-compatible Artifact Store for production.
- OpenTelemetry with console, JSONL, and OTLP exporters.
- MIT license, third-party notices, SBOM, attestations, and trusted publishing.

Canonical distribution names are `graph-engineering` on npm and PyPI. Apply for the npm `@graph-engineering/*` scope and audit `grapheng` and `graphengineering` as real compatibility aliases where registry rules allow. Do not publish empty squatting packages. The primary executable is `graph`, with `grapheng` as a compatibility alias.

### Graph IR

```ts
interface GraphSpec {
  apiVersion: "graphengineering.reacher-z.github.io/v1alpha1";
  kind: "Graph";
  metadata: {
    name: string;
    version: string;
    description?: string;
    labels?: Record<string, string>;
  };
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  stateSchema?: JsonSchema;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  policies?: GraphPolicies;
}
```

TypeScript builders, Python builders, YAML, and JSON compile to this IR. Graph, node, edge, and schema values receive stable content hashes. Runs bind to an immutable compiled graph hash and monotonically increasing graph revision. The compiler validates identity, reachability, endpoints, port/schema compatibility, router exhaustiveness, concurrent state writes, budgets, capabilities, and loop bounds. Ordinary edges cannot create implicit cycles; explicit loop nodes are required. Nested subgraphs have namespaces and checkpoint scopes.

### Nodes and edges

```ts
interface NodeSpec {
  id: string;
  kind: "agent" | "model" | "tool" | "transform" |
        "subgraph" | "router" | "barrier" | "validator" | "human";
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  config: unknown;
  retry?: RetryPolicy;
  timeoutMs?: number;
  cache?: CachePolicy;
  resources?: ResourcePolicy;
  isolation?: IsolationPolicy;
  sideEffects?: "none" | "idempotent" | "non-idempotent";
}

interface EdgeSpec {
  id: string;
  from: { node: string; port?: string };
  to: { node: string; port?: string };
  map?: DataMapping;
  condition?: Predicate;
  mode?: "value" | "stream" | "artifact-ref";
  schema?: JsonSchema;
}
```

Node input is validated before execution and output before persistence. Edges represent real data dependencies, not textual order. Deterministic transforms handle map/filter/flatten/dedupe. Concurrent writes require an explicit reducer. Large values are artifacts and edges carry `ArtifactRef` values.

### Execution primitives

- `parallel`: bounded concurrency with all, partial, quorum, and fail-fast policies; structured settled results; cancellation, rate limits, and backpressure; no silent null failures.
- `pipeline`: per-item stage streaming with bounded buffers and stop/drop/dead-letter/retry policies; no accidental whole-stage barrier.
- `barrier`: all, minimum-N, percentage, quorum, and deadline conditions; durable state and complete success/failure/missing statistics.
- `router`: schema-constrained classification, single/multi-cast, exhaustive cases or default, confidence escalation, and replayed decisions.
- `fanOutReduceSynthesize`: breadth from workers, deterministic reduction, and model judgment only for semantic synthesis.
- Dynamic `GraphPatch`: append-only graph revisions checked by the same compiler, policy, permissions, and budgets; capped depth, fan-out, nodes, and attempts; dry-run support.
- `untilDry`, bounded `while`, and evaluator-optimizer loops: global seen set, semantic convergence plus hard iteration/duration/cost/node limits, first-class exit reasons, and unknown verifier state.

### Verification

Built-in patterns include adversarial refutation, diverse correctness/security/performance/reproducibility/source-quality lenses, deterministic checks, citation verification, judge panels, quorum/majority/abstention, and rubric-based reflection. Makers and verifiers use isolated contexts. Verifiers inspect original evidence. All votes are retained. Insufficient quorum becomes unknown or a human gate, never an implicit pass. Rubrics and tie-break rules are versioned and deterministic.

### Durable execution

Public extension interfaces include `EventStore`, `CheckpointStore`, `ArtifactStore`, and `LockManager`. The append-only event log is the source of truth; snapshots accelerate recovery. Successful node outputs are durably written immediately. Lease/CAS semantics prevent two orchestrators from advancing the same run. Resume reuses successful results; replay and fork create traceable histories. Internal persisted results are effectively-once, while external activities are documented as at-least-once with idempotency keys. Resuming a non-idempotent node requires confirmation.

### Security and isolation

Nodes declare tool, filesystem, network, and secret capabilities. Planners cannot expand their own authority. Model and tool content is untrusted. Shell, writes, network, and external side effects are deny-by-default. Worktree isolation includes leases, allowed/denied paths, deterministic branch names, cleanup, and a separate tested merge node. Conflicts are structured failures. Process and container providers isolate ports, temp files, caches, and database namespaces as well as files.

### Provider and tool adapters

Official v1 adapters: deterministic mock, OpenAI, Anthropic, Google Gemini, OpenAI-compatible/local endpoints, HTTP, shell/subprocess, and MCP. Claude Code, Codex, and generic agent harness integrations are documented without claiming unsupported private APIs. All adapters share capability discovery, structured output, streaming, tools, usage, retries, rate limits, and cancellation conformance.

### CLI and MCP

```text
graph init                    graph add <pattern>
graph validate [file]         graph compile [file]
graph plan [file]             graph run [file]
graph status|watch|inspect    graph logs --json
graph pause|resume|cancel     graph retry --node
graph replay --from           graph fork --from
graph cost                    graph doctor
graph score                   graph badge
graph visualize               graph worktree list|prune
graph artifact get            graph plugin list|doctor
graph mcp serve
```

Every command has documented machine-readable JSON, error envelopes, and exit codes. Doctor checks schemas, stores, providers, credentials, version drift, orphan leases/worktrees, security defaults, and returns the top three corrective actions. MCP is read-only by default; mutating operations require explicit enablement, policy, and human approval.

### Explorer and observability

Static and live views show graph topology, node states, edge hashes, budget, critical path, parallel utilization, barrier wait, retries, and verifier verdicts. Checkpoint time travel compares replay/fork histories. A run is a root trace; node attempts are spans; model/tool/artifact/worktree operations are children. Prompt/response capture is opt-in and redacted. Product telemetry is off by default.

## 4. Patterns, education, and complete product surface

Ten executable patterns ship in YAML/JSON, TypeScript, and Python:

1. Multi-source research diamond.
2. Cited deep research with citation verification.
3. Route authentication security sweep.
4. Diff risk router with diverse judge panel.
5. Loop-until-dry bug discovery.
6. File-by-file migration with worktrees and test gates.
7. CI failure sweeper.
8. Dependency update sweeper.
9. PR babysitter.
10. Scheduled ecosystem scan.

Every pattern includes fixtures, expected events, mock execution, real-provider setup, architecture diagrams, budgets, permissions, failure/resume demonstrations, tests, and Claude Code/Codex/MCP/shell guides.

The fourteen-step roadmap becomes an executable course covering real data edges, fake-edge audits, contracts, diamond topology, pipelines versus barriers, dynamic routing, adversarial verification, isolation, convergence, model tiering, persistence, cost/latency topology, and safe self-routing. It also documents when not to use a graph.

Product parity tools include init, doctor, Graph Ready G0-G4 scoring, badges, cost estimation, a pattern picker, anti-pattern and failure-mode guides, operating/safety documentation, authentic success and failure stories, an interactive showcase, an adopter gallery, and a trace gallery. Scoring is deterministic and produces the top three remediation actions.

## 5. Twenty-one-day execution calendar

| Day | Main/integration | TypeScript lane | Python lane | Platform/quality/growth lane | Exit gate |
|---|---|---|---|---|---|
| 1 | Materialize plans, restore remote, freeze IR/events/ADRs | Workspace/bootstrap | Workspace/bootstrap | CI, governance, registry audit | Contracts, ownership, risks frozen |
| 2 | Review canonical serialization | Builders and schema types | Builders and Pydantic models | JSON Schema, negative fixtures, CLI contract | Byte-equivalent canonical IR |
| 3 | Freeze diagnostics | Compiler and DAG validation | Compiler and DAG validation | init/validate/plan, Quickstart v0 | Shared invalid-graph fixtures pass |
| 4 | Integrate chain/diamond | Scheduler and fan-out/in | Scheduler and fan-out/in | Trace viewer and concurrency tests | Deterministic diamond parity |
| 5 | Review scheduling semantics | Pipeline/barrier/backpressure | Pipeline/barrier/backpressure | Research demo and benchmarks | Fast items avoid false barriers |
| 6 | Freeze state/failure envelopes | Router/failure/quorum | Router/failure/quorum | Diff-review and failure injection | Every terminal state is defined |
| 7 | Alpha 1 integration | Bounded cycles | Bounded cycles | Discovery demo and content | `0.1.0-alpha.1` |
| 8 | Retry/cancel review | Retry/timeout/cancel | Retry/timeout/cancel | Chaos matrix, watch/inspect | No unbounded retry path |
| 9 | Durable semantics review | Events/checkpoints/SQLite | Events/checkpoints/SQLite | Crash/resume tests and run view | Successful nodes never rerun |
| 10 | Budget/model contract | Cost/budget/model router | Cost/budget/model router | Cost UI and pricing snapshots | Hard budgets stop scheduling |
| 11 | Verifier semantics review | Verifiers/judges/reflection | Verifiers/judges/reflection | Cited report and verifier tests | Rejected/unknown results gated |
| 12 | Isolation/threat review | Worktree/process isolation | Worktree/process isolation | Migration demo and escape tests | Parallel writes stay isolated |
| 13 | Alpha 2 integration | Provider adapters | Provider adapters | Doctor/score/badge/visualize | `0.2.0-alpha.2` |
| 14 | Public API freeze | MCP/runtime extensions | Plugin extensions | MCP and all pattern skeletons | Alpha API and IR frozen |
| 15 | Performance review | PostgreSQL/S3/worker mode | PostgreSQL/S3/worker mode | Explorer, site, video | First run under five minutes |
| 16 | Security preflight | Redaction/policy hardening | Redaction/policy hardening | Threat model, fuzz, SBOM | No high/critical blocker |
| 17 | Beta integration | Bug burn-down | Bug burn-down | API docs and external testers | `0.9.0-beta.1` and feedback |
| 18 | Compatibility audit | TS fixes | Python fixes | Benchmarks/cases/launch copy | No conformance divergence |
| 19 | RC freeze | Clean install/upgrade | Clean install/upgrade | Release matrix and doc tests | `1.0.0-rc.1` |
| 20 | Provenance/go-no-go | npm rehearsal | PyPI rehearsal | Site/assets/community | All mandatory gates green |
| 21 | Release/support | npm release/support | PyPI release/support | GitHub/site/content/community | v1 if green; otherwise full RC |

Interface freezes: canonical IR on Day 2, state machines on Day 6, event/checkpoint semantics on Day 9, public alpha API on Day 14, and complete feature freeze on Day 19.

## 6. Testing and release acceptance

TypeScript and Python must produce the same canonical hashes, compilation verdicts, route/barrier/quorum semantics, event ordering constraints, terminal states, replay/fork results, stable error codes, and JSON envelopes.

Mandatory tests cover missing/duplicate/unreachable nodes, invalid ports and schemas, implicit cycles, incomplete routers, unbounded loops, unauthorized transforms, 100-way parallel concurrency, all failure policies, streaming/backpressure, barrier timeouts, router replay, malicious dynamic patches, verifier pass/reject/abstain, seen-set convergence, hard loop stops, crash recovery at every checkpoint, dual-resume races, replay/fork, stale approvals, worktree conflicts, port isolation, provider fallback, secret redaction, cancellation, prompt injection, complete CLI flow, storage conformance, all pattern e2e tests, 1,000-node resource bounds, and kill/network/store/artifact chaos.

Quality thresholds:

- Compiler, scheduler, event store, and policy: at least 90% statement and 85% branch coverage.
- At least 250 unit/integration cases per language.
- One shared adapter/storage conformance suite.
- One hundred randomized failure runs without deadlock, unbounded spawn, or budget escape.
- Linux/macOS/Windows; Node 20/22; Python 3.11/3.12/3.13.
- Mock providers for normal CI; real providers only opt-in/nightly.
- Performance regressions above 10% block merging without an approved baseline ADR.
- No unaccepted high/critical vulnerability; secret, dependency, license, and static analysis scans pass.
- Trusted npm/PyPI publishing, SBOM, checksums, and attestations.
- Quickstart uses no more than three commands; at least 80% of external testers finish within five minutes.
- No P0/P1 defects and at least five external usability reports before stable v1.

## 7. Organic launch and 6,000-star target

The growth loop is: clear concept -> sixty-second demo -> five-minute successful run -> shareable trace/score -> user pattern or adapter -> authentic case study -> new user.

Launch assets include a sixty-second Quickstart, ninety-second uncut terminal demo, interactive linear-versus-graph visualization, fourteen-step executable roadmap, architecture essay, side-by-side TS/Python examples, reproducible performance/recovery benchmarks, four case studies including one failure, Graph Ready badge, adopter/trace galleries, bilingual launch summaries, and channel-specific material for GitHub, Hacker News, X, LinkedIn, Reddit, Dev.to, and Chinese developer communities.

Release/content beats: daily build-in-public through Day 6; Alpha 1 on Day 7; crash/resume on Day 9; verifier demo on Day 11; dual-language Alpha 2 on Day 13; benchmarks and Explorer on Day 15; tester-backed Beta on Day 17; RC and security story on Day 19; coordinated release on Day 21.

Stretch star milestones are Day 7: 300, Day 13: 1,000, Day 17: 2,000, and Day 21: 6,000+. Controlled leading goals are 2,000 CLI downloads, 500 successful/self-reported runs, ten public adopters, ten outside contributors, twenty-five external PRs, response p50 below twelve hours, and ten personalized creator/maintainer trial invitations.

Weekly successful graph runs, seven-day retained repositories, time to first success, external adopters, and non-maintainer merged PRs are the real north-star measures. High visits with low stars triggers positioning work; stars without installs triggers Quickstart work; installs without successful runs pauses promotion; runs without retention triggers use-case and reliability work.

## 8. Risks and fixed assumptions

- Full platform, not a documentation-only or runtime-only project.
- TypeScript and Python are both native runtimes; Python is not silently downgraded to a TypeScript client.
- Quality gates outrank the Day-21 stable label.
- Repository target is `reacher-z/GraphEngineering`; restore/recreate it before publishing.
- Apply for legitimate npm/PyPI variants `graph-engineering`, `grapheng`, and `graphengineering`.
- Growth is organic, with 6,000+ as a stretch outcome and 9,416+ as the current moving popularity-parity baseline.
- MIT license; English canonical docs plus Chinese README/Quickstart/launch material.
- Telemetry off by default; deterministic mock provider is the default Quickstart.
- SQLite/local artifact storage by default; PostgreSQL/S3 production adapters.
- External side effects are at-least-once with idempotency, never falsely marketed as absolute exactly-once.
- All dynamic patches pass compiler/policy/budget gates; MCP is read-only by default; every cycle is bounded.
- Do not use “battle-tested” or “production proven” without real evidence.

Primary risks are cross-language drift, scope overload, late integration, provider flakiness, uncontrolled cycles, shell/MCP permissions, registry naming conflicts, and vanity growth. The controls are shared conformance fixtures, contract-first development, daily integration, mock-first CI, hard resource limits, deny-by-default capabilities, Day-1 registry audit, and public separation of stars from activation and retention.
