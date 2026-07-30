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

## 9. Append-only full-platform completion expansion

This section was appended after the original 368-line plan. It does not edit,
delete, weaken, reinterpret, or replace any earlier requirement. Its purpose is
to convert every remaining product promise into an implementation and evidence
contract detailed enough for parallel execution without losing correctness.
Where this expansion is stricter than an earlier summary, the stricter gate is
additional work. Where the original plan already names a stronger requirement,
the original requirement remains authoritative.

### 9.1 Immutable baseline and honest status

The append-only baseline is the independent exhaustive audit recorded in
`codex_logs/reviews/MASTER-PLAN-EXHAUSTIVE-GAP-AUDIT-2026-07-26.md` against
commit `d5bcc0186ea743bad5bd8a1e597dc83f54310c11`. At that snapshot:

- all 21 calendar days were represented in the delivery matrix;
- all 107 registry task IDs were unique and represented exactly once in the
  task ledger;
- all 178 release leaves were mapped, but all 178 remained Open;
- 40 task records were historically completed, 3 were in progress, and 64
  were planned;
- task-level scanner evidence was `10/77`;
- release-candidate evidence weight was `0/93`; and
- no stable v1 or complete RC decision was authorized.

Those numbers are a dated baseline, not a frozen target and not a completion
claim. New tasks MAY be appended when implementation reveals missing work. A
new task MUST name its dependency, owner, artifacts, tests, reviewer, security
impact, release leaves, and rollback boundary. It MUST NOT silently replace an
existing task, erase failed evidence, reduce a release threshold, or make an
external outcome controllable by declaration.

### 9.2 Definition of “the plan is completely implemented”

The plan is complete only when all of the following are simultaneously true
against one immutable candidate:

1. Every required protocol has a closed, versioned, resource-bounded schema
   and normative semantics.
2. Every promised runtime behavior has independent native TypeScript and
   native Python implementations. Neither implementation shells out to,
   embeds, or treats the other language as its semantic oracle.
3. Shared conformance executes real behavior in both runtimes and compares
   canonical bytes, hashes, diagnostics, events, checkpoints, outputs, exit
   codes, costs, and failure envelopes.
4. Every public CLI, SDK, MCP, plugin, adapter, storage, isolation, and web
   surface is exercised from packed or installed artifacts, not only source
   imports.
5. All deterministic tests, property tests, fuzzers, chaos campaigns,
   performance thresholds, security reviews, portability jobs, and package
   provenance gates pass with no open P0/P1 and no unaccepted high/critical
   issue.
6. All ten pattern bundles and the fourteen-step course execute in YAML/JSON,
   TypeScript, and Python with deterministic mock providers and documented
   opt-in real-provider setup.
7. Documentation, examples, generated references, launch copy, screenshots,
   demos, package READMEs, site content, and known-limit lists describe exactly
   the same candidate and do not overstate durability, security, isolation,
   popularity, or production readiness.
8. Trusted npm and PyPI publication identity, checksums, SBOMs, attestations,
   source-to-package identity, clean installation, upgrade, rollback, yank,
   and incident procedures are independently verified.
9. Authentic external usability and support evidence exists: at least five
   consented reports, at least 80% completion within five minutes, retained
   failed attempts, retest dispositions, multiple operating systems, both
   language paths, and no open P0/P1.
10. Every mandatory release-checklist leaf is Green against the same candidate,
    all 93 required ancestors carry exact overlay evidence, and an independent
    reviewer signs the stable-versus-complete-RC-versus-no-release decision.

File existence, schema compilation, task status, scanner health, test volume,
a tag, a local package rehearsal, a mutable worktree, a demo, or a star count
cannot substitute for that conjunction.

### 9.3 State taxonomy used by all future work

Every capability and artifact MUST use one of these explicit states:

- **Absent**: no artifact or implementation exists.
- **Draft**: mutable design or implementation exists but has no accepted
  contract.
- **Contract accepted**: normative schemas, semantics, fixtures, and hostile
  review pass; native implementation may still be absent.
- **Native one-language implementation**: exactly one runtime executes the
  behavior; cross-language claims are forbidden.
- **Native dual-language implementation**: both runtimes execute it, but the
  shared join or candidate evidence is incomplete.
- **Conformant source milestone**: both runtimes pass shared behavior from a
  clean immutable source revision; packaging, portability, or release evidence
  may remain open.
- **Candidate Green**: the complete requirement passes from installed candidate
  artifacts with exact evidence, independent review, and no excluded subcase.
- **Released**: the authorized artifact/channel is public and its remote digest
  matches the approved candidate.
- **External outcome observed**: an authentic adoption, usability, support, or
  growth result has been recorded without fabrication.

Status prose MUST name the exact state. “Implemented” without a scope,
revision, runtime set, and exclusion list is invalid status language.

### 9.4 Evidence tuple required for every completed implementation task

Every future task marked completed MUST retain:

1. full source commit and tree object IDs;
2. exact parent/base revision and dependency revisions;
3. exact changed-path manifest and path-list digest;
4. author and committer identity with no unrequested co-author trailer;
5. contract/schema/fixture digests consumed by the implementation;
6. exact commands as argv arrays, working directories, tool versions, platform,
   timestamps, exit codes, and immutable reports;
7. coverage mapping from every expected test and artifact to exact evidence;
8. negative and hostile tests proving that omission, mutation, stale history,
   unsafe paths, and unsupported values fail closed;
9. independent reviewer identity, report digest, decision, exclusions, and
   open P2 maintenance findings;
10. clean detached-worktree or clean installed-artifact revalidation;
11. candidate/release exclusions stated explicitly; and
12. remote ref verification after push when public availability is claimed.

Evidence is append-only. A failure, reopen, or superseding contract remains in
history. Re-closing requires later unique command and review evidence; old
reports cannot be reused under a new candidate.

### 9.5 Dependency and concurrency law

The fastest permitted execution is the fastest topology that preserves the
contracts:

- Main/integration owns `spec/`, root configuration, the task registry,
  release map, evidence overlay, shared fixtures, and final joins.
- A TypeScript lane owns only its assigned `packages/**` paths.
- A Python lane owns only its assigned `python/**` paths.
- Platform lanes own explicitly assigned `apps/`, `tools/`, `docs/`,
  `examples/`, packaging, benchmark, or site paths.
- A reviewer writes its report and MAY identify fixes, but the final candidate
  needs a reviewer independent from the producer and from reused report bytes.
- Shared root-owned files are serialized. A temporary inconsistent state must
  fail closed and must be followed by a final green rerun after writers quiesce.
- A specification task MUST be scoped so that it can complete before the native
  tasks that depend on it. Native absence belongs to downstream implementation
  and conformance tasks rather than creating a circular completion dependency.
- TypeScript and Python implementation lanes may run concurrently only after
  the contract and fixture hashes are frozen. Neither lane edits the shared
  fixtures during implementation.
- Cross-language joins begin only after both native lanes publish their reports.
- Security-sensitive protocols such as redaction, approval, capability policy,
  artifact access, and provider tools require independent hostile review before
  downstream runtime expansion.

The four-slot default priority is: one main/integration lane, one contract or
independent-review lane, one TypeScript implementation lane, and one Python or
platform lane. As soon as a contract is accepted, its review slot is reused for
the next ready implementation or hostile join. No slot is kept busy with fake
heartbeats, redundant summaries, or work that cannot merge safely.

### 9.6 Critical no-skip chain

The following joins are mandatory even when implementation order overlaps:

```text
D7 cycle contract
  -> native TS cycles + native Python cycles
  -> executable cycle/GraphPatch conformance
  -> runtime chaos and budget contract

D9 redaction contract
  -> native TS sink-before-write + native Python sink-before-write
  -> byte-level redaction/canary conformance
  -> approval + extended durability

D4 subgraph/reducer/stream/artifact contract
  -> native graph execution parity
  -> API freeze and production ArtifactStore/Explorer work

router/barrier runtime + extended durability + budget
  -> verifier/judge/reflection
  -> isolation/policy
  -> adapters/tools
  -> plugin/MCP/API freeze
  -> storage/workers/observability/Explorer
  -> security/privacy/performance
  -> Beta/usability/compatibility/support
  -> RC/provenance/final roll-up
  -> stable v1, complete RC, or no-release decision
```

No content deadline, popularity target, or already-published alpha tag may
remove a node or edge from this dependency graph.

## 10. Canonical protocol and compiler completion workstream

### 10.1 Graph IR versioning and compatibility

The canonical Graph IR MUST support explicit protocol negotiation rather than
accidental shape compatibility. Complete this work with:

- a versioned top-level Graph IR envelope and immutable dialect identifier;
- documented additive, breaking, deprecated, and reserved-field rules;
- a compatibility table for every released schema revision;
- canonical migrations that produce a new document and never mutate retained
  historical bytes;
- stable domain-separated graph, node, edge, schema, component, revision,
  artifact, event, checkpoint, and policy identities;
- unknown-field rejection for closed protocol objects;
- explicit extension namespaces for approved open maps;
- hard byte, depth, node, edge, output, port, schema, and diagnostic bounds;
- Unicode scalar, object-key ordering, duplicate-key, numeric, surrogate, and
  canonical JSON behavior frozen across languages; and
- a tombstone/reservation policy preventing removed names or error codes from
  being silently reused with different meaning.

Acceptance requires positive, negative, mutation, migration, and downgrade
fixtures in both runtimes. Every canonical byte and hash MUST match exactly.

### 10.2 Complete node-kind contract

Freeze and implement closed contracts for at least:

- deterministic transform;
- model invocation;
- tool invocation;
- router/classifier;
- settled barrier and quorum gate;
- human approval gate;
- verifier, judge, citation verifier, and reflection node;
- subgraph invocation;
- artifact producer/consumer;
- stream producer/stage/consumer;
- cycle controller and dynamic patch planner;
- external activity with idempotency and approval metadata;
- storage/lock operation where exposed as graph work; and
- explicit terminal/synthesis node.

For each node kind define closed config, input/output ports, authority ceiling,
budget reservation, timeout/retry/cancel semantics, event set, replay behavior,
checkpoint projection, failure policies, deterministic mock, and unsupported
combinations. A free-form `config` map is not a substitute for a versioned
public contract.

### 10.3 Typed ports and schema assignability

Extend the current strict-exact typed-port slice into a complete bounded
assignability system:

- freeze the supported JSON Schema dialect and keyword subset;
- reject foreign dialects, remote references, recursive references, unsafe
  regular expressions, ambiguous numeric domains, unsupported applicators, and
  implementation-specific extensions;
- define input/output requiredness, optionality, nullability, defaults,
  enums/const, arrays/tuples, object closure, numeric/string limits, and local
  definition resolution;
- distinguish compile-time assignability from runtime value validation;
- validate graph inputs, node inputs, executor outputs, reducer outputs,
  artifact metadata, stream items, and final graph outputs before unsafe
  persistence or downstream release;
- return ordered structured diagnostics with stable codes and JSON pointers;
  and
- prove TS/Python parity with generated, hand-authored, and adversarial schema
  pairs.

Assignability MUST be conservative. “Unknown” or an unsupported keyword is a
compile failure unless an explicitly versioned policy says otherwise.

### 10.4 Compiler passes and immutable plan

The compiler MUST expose deterministic passes for:

1. transport/profile validation;
2. model/schema validation;
3. identity and duplicate detection;
4. endpoint and port resolution;
5. typed-port assignability;
6. entrypoint/output validation;
7. reachability and namespace validation;
8. ordinary-DAG cycle rejection;
9. router exhaustiveness and barrier/quorum validation;
10. subgraph recursion and scope validation;
11. reducer/state conflict analysis;
12. artifact/stream edge lowering;
13. authority/capability ceiling validation;
14. budget/resource feasibility;
15. node-kind support and provider requirements;
16. deterministic topological layering and execution-plan generation; and
17. plan/component/revision hashing.

The output plan is closed, immutable, serializable, independently hashable,
and contains no executable closures or ambient process references. Diagnostic
order is stable across insertion orders and hosts. A failed pass emits no
partial executable plan.

### 10.5 Compiler test and performance gates

Required compiler evidence includes:

- every mandatory invalid graph scenario;
- randomized graph/schema generation with reproducible seeds;
- mutation tests for each diagnostic branch;
- 1,000-node and maximum-bound fixtures with time and memory ceilings;
- repeated compilation yielding identical bytes and hashes;
- cache correctness with invalidation on every semantic dependency;
- hostile input resource limits before recursive allocation;
- packed CLI and SDK compilation from JSON and safe YAML; and
- at least 90% statements and 85% branches against candidate artifacts.

## 11. Native execution kernel completion workstream

### 11.1 Deterministic scheduler

Both native schedulers MUST implement the same ready-queue semantics:

- stable node readiness and tie-breaking;
- bounded global and per-kind concurrency;
- no release before predecessor result/event durability conditions pass;
- exact attempt allocation and accounting;
- structured success, failure, cancellation, skip, drop, dead-letter,
  unknown, and partial terminal states;
- immutable detached input/output snapshots;
- cooperative cancellation with bounded treatment of non-cooperative work;
- timeout and retry scheduling without hidden unbounded loops;
- upstream failure isolation and declared downstream failure policy;
- final output binding only after every required terminal condition; and
- zero model/provider dependency in deterministic CI.

Stress evidence MUST cover 100-way parallelism, mixed slow/fast work, resource
ceilings, cancellation races, executor registry mutation, hostile output,
clock/event factory failure, task leaks, and deterministic repeated traces.

### 11.2 Pipelines and real backpressure

Integrate the standalone bounded pipeline into Graph IR without turning a
stream edge into a whole-stage array:

- lazy source admission;
- bounded per-stage and global in-flight counts;
- demand propagation from downstream to upstream;
- ordered and completion-order delivery policies;
- per-item retry/timeout/cancel/failure envelopes;
- stop/drop/dead-letter behavior with retained evidence;
- no false barrier between independent items;
- deterministic cleanup and iterator closure;
- spill/artifact policy for explicitly allowed large items; and
- clear exclusion or later contract for durable per-item recovery.

Prove that fast item A can reach stage 3 while slow item B remains in stage 1,
that buffers never exceed configuration, and that cancellation closes every
owned producer/iterator without swallowing the terminal cause.

### 11.3 Routers, barriers, quorum, and human gates

Move pure route/barrier evaluators into scheduler-integrated durable behavior:

- exhaustive single-route and multicast decisions;
- explicit default/no-match handling;
- confidence threshold and human escalation;
- recorded decision identity so replay never re-judges;
- all/minimum/percentage/quorum barrier policies;
- success, failure, missing, abstain, and unknown statistics;
- deadline/timeout settlement with a deterministic clock;
- retained votes and evidence for verifier barriers;
- insufficient quorum becoming unknown or human-gated, never implicit pass;
  and
- cancellation/late-arrival behavior after a barrier decision.

Cross-language tests compare selected routes, barrier result bytes, events,
deadlines, missing counts, replay provider-call counts, and terminal outputs.

### 11.4 Failure-policy algebra

Define and implement a closed failure-policy algebra covering retry, fail-fast,
stop, skip, drop, dead-letter, continue-with-partial, fallback, compensate,
quorum, and human escalation. Each policy MUST state:

- eligible failure classes;
- maximum attempts and timeout relationship;
- which results become downstream-visible;
- event/checkpoint representation;
- interaction with cancellation and graph termination;
- budget/cost accounting;
- replay/resume behavior;
- whether an external effect requires idempotency or approval; and
- final result and CLI exit-code projection.

An implementation MUST reject a policy/node-kind combination it cannot honor.
It MUST NOT silently turn a failed value into `null`.

## 12. Bounded cycles and dynamic GraphPatch completion workstream

### 12.1 Contract boundary

Ordinary Graph IR remains acyclic. Dynamic repetition is executed only through
an explicit versioned controller request whose contract has been independently
accepted. A prompt, metadata field, backward edge, arbitrary node config, or
planner free text cannot create a cycle.

The accepted v1alpha1 controller contract MUST remain the source of truth for:

- `until-dry`, bounded `while`, and evaluator-optimizer modes;
- complete effective policy with no implicit infinity;
- authoritative objective, implementation, pricing, authority, key-strategy,
  rubric, graph-revision, and lineage identities;
- closed finder, evaluator, condition, optimizer, and patch-planner bindings;
- global durable seen set;
- exact round plan and worst-case reservation;
- stable events, checkpoints, results, terminal observations, and hashes;
- start, resume, replay, and fork separation;
- lease/fencing and event-stream CAS;
- GraphPatch validation, authorization, compile/dry-run, acceptance, rejection,
  idempotent retry, and append-only revision semantics; and
- truthful inline-alpha payload boundary until D9 protection is implemented.

### 12.2 Native TypeScript controller

The TypeScript runtime MUST implement, without Python delegation:

- exact request validation and domain-separated request/controller hashes;
- an immutable controller state fold from canonical events;
- a store abstraction with atomic expected-version append and checkpoint write;
- start refusing non-empty streams;
- resume refusing empty, terminal, stale-request, stale-revision, stale-lease,
  or mismatched-authority streams;
- replay reading a valid prefix without activity dispatch or writes;
- fork binding exact parent run, sequence, and history hash while leaving the
  parent unchanged;
- deterministic round planning and maximum attempt/cost/structure reservation;
- full batch validation before atomic discovery and seen insertion;
- exact verdict coverage for fresh candidates;
- mode-specific convergence and terminal precedence;
- cancellation before and after every durable boundary;
- in-doubt activity retention when an external outcome cannot be proven;
- checkpoint reconstruction and verification against the entire event prefix;
- GraphPatch hash, policy, authority, budget, compiler, complete-graph limit,
  and base-CAS gates;
- exact accepted/rejected idempotent retry behavior; and
- structured failures for every invalid history, activity output, budget,
  deadline, patch, lease, and storage race.

TypeScript tests MUST consume the shared fixtures and add implementation-hostile
cases for getters/proxies, mutation, unsafe numbers, clock rollback, event
factory failure, store CAS races, cancellation swallowing, stale leases,
duplicate activity completion, corrupted checkpoints, and executor output
mutation.

### 12.3 Native Python controller

The Python runtime MUST implement the same semantics independently:

- no Node subprocess and no TypeScript-generated runtime answer;
- exact portable capture without virtual model dispatch or hostile getters;
- Pydantic/public model boundaries that cannot widen accepted wire values;
- the same canonical hashes, state fold, reservations, counters, seen order,
  verdict rules, patch decisions, results, and events;
- asyncio cancellation handling that does not let a handler swallowing
  cancellation commit new work after a durability failure;
- atomic store and checkpoint contracts with equivalent race behavior;
- exact timer/number bounds portable to the supported Python matrix; and
- detached immutable public results.

Python tests mirror every shared behavioral case while retaining independent
unit and hostile tests. Passing because Python invokes Node or reads a TS report
is prohibited.

### 12.4 Executable cycle conformance

The shared D7 join MUST execute, in both languages:

- every valid policy/request/result/revision/event/checkpoint fixture;
- until-dry convergence with rejected and unknown findings retained in seen;
- duplicate keys within and across rounds;
- while false/true transitions and evaluator accept/revise/unknown paths;
- iteration, duration, cost, attempt, discovery, dynamic-node, depth, fan-out,
  total-node, total-edge, output, candidate-count, item-byte, and batch-byte
  boundaries, with one exact-bound and one over-bound test each;
- under-reservation and lying-plan rejection;
- malicious, stale-base, unauthorized, over-budget, invalid-schema,
  capability-expanding, recursive, and oversized patches;
- accepted/rejected patch idempotent retry and ID conflict;
- cancellation on both sides of each reservation/discovery/evaluation/patch
  durable boundary;
- crash/resume with zero repeated committed finder/evaluator/planner work;
- replay with zero provider/tool/model/clock dispatch and zero writes;
- fork lineage and parent immutability;
- lease winner/loser and stale-fence behavior;
- checkpoint substitution and full-prefix fold comparison; and
- exact canonical result/event/checkpoint bytes and hashes.

The conformance report MUST prove that native result bytes agree, not merely
that each runtime separately returned success.

### 12.5 D7 completion boundary

`D7-CYCLE-SPEC-024` may complete when its contract, schemas, fixtures, semantic
oracles, and hostile independent review have no open P0/P1. Native execution is
explicitly outside 024 and remains Open in `D7-TS-CYCLES-025`,
`D7-PY-CYCLES-026`, and `D7-CYCLE-CONFORMANCE-027`. Full Day-7 dynamic-cycle or
GraphPatch capability is Green only after all four tasks and candidate-bound
release leaves pass.

## 13. Subgraphs, state reducers, artifacts, streams, and trace workstream

### 13.1 Nested subgraph execution

Freeze a dedicated contract before implementation. It MUST define:

- globally unique invocation identity and deterministic child namespace;
- explicit parent input projection and child output projection;
- child graph/plan/revision identity;
- maximum nesting depth and recursion rejection;
- independent child entrypoints/outputs without namespace collision;
- inherited versus explicitly narrowed capabilities and budgets;
- cancellation and failure propagation in both directions;
- child event/checkpoint scope and parent linkage;
- replay/fork lineage across the boundary;
- whether successful child internals may be reused after parent recovery;
- how child artifacts and streams cross the boundary; and
- deterministic trace/span topology.

Existing schedulers that treat a `subgraph` kind as an arbitrary executor call
are not conformant. Native implementations must execute the child plan and
produce the specified history, rather than hiding it inside an opaque closure.

### 13.2 Concurrent state reducers

State is explicit data, not a mutable shared Python dict or JavaScript object.
For every state key define:

- schema and canonical identity;
- initial value or required-input rule;
- writer set;
- reducer kind and versioned reducer identity;
- total deterministic ordering or declared commutative/associative law;
- validation before commit;
- conflict, retry, and CAS behavior;
- event and checkpoint representation;
- replay/fork semantics;
- maximum value and update size; and
- redaction/artifact policy.

Provide built-in closed reducers for replace-with-single-writer, ordered append,
set-union by canonical identity, bounded numeric aggregation, min/max, and
explicit custom deterministic transform. Custom reducers execute without
ambient authority and must be content-addressed/versioned. Concurrent
unreduced writes are a compile error, never last-writer-wins by scheduler race.

### 13.3 Artifact references

An artifact reference MUST be a closed content-addressed capability, not a raw
path or arbitrary URL. Define:

- digest algorithm and canonical metadata;
- size, media type, logical name, creation task, and producer attempt;
- storage namespace and tenant/run binding;
- optional encryption/protection/key identity without embedding credentials;
- retention and garbage-collection eligibility;
- read/write/list/delete capabilities;
- atomic finalize and partial-upload cleanup;
- integrity verification on every read;
- deduplication and collision behavior;
- checkpoint/event projection;
- replay/fork ownership and sharing rules;
- support-bundle and export redaction behavior; and
- structured missing, corrupt, unauthorized, oversized, or expired failures.

The first local implementation uses safe repository-independent storage with
exclusive creation, no-follow path resolution, bounded reads/writes, fsync and
atomic rename where required. S3 and other remote stores follow the same
conformance suite and cannot weaken digest or authority checks.

### 13.4 Executable stream edges

A stream edge MUST carry a versioned stream descriptor and demand protocol.
It cannot be lowered to an ordinary value edge or collected array without an
explicit materialization node. Define:

- producer, consumer, item schema, ordering, buffer bound, and demand window;
- one-to-one, broadcast, partitioned, and merge semantics where supported;
- backpressure propagation;
- item attempt and failure identity;
- cancellation and late-item behavior;
- terminal success/error/cancel frames;
- maximum item and aggregate in-flight bytes;
- artifact spill policy;
- checkpoint boundary and declared durability limitations;
- replay behavior and duplicate suppression when durable mode exists; and
- trace metrics for queue depth, blocked time, throughput, and lag.

Tests use slow consumers, bursty producers, failure mid-stream, cancellation,
multiple downstreams, bounded memory probes, and false-barrier detection.

### 13.5 Trace contract

Every run emits a stable normalized trace projection with:

- run, graph, plan, revision, node, edge, attempt, activity, controller,
  subgraph, artifact, stream, and provider identities;
- causal parent/child and event sequence references;
- monotonic duration plus recorded wall-clock envelope;
- state transitions and structured failures;
- retry, barrier wait, queue wait, backpressure wait, approval wait, and
  checkpoint/recovery spans;
- usage/cost/budget reservations and releases;
- redaction/capture disposition without secret values;
- critical path and parallel utilization inputs; and
- deterministic export normalization for cross-language comparison.

The trace contract precedes the web Explorer. The Explorer consumes the public
contract rather than private runtime objects.

### 13.6 D4 acceptance

Contract schemas and fixtures are necessary but not sufficient. The D4 task
remains in progress until native TypeScript and Python execution covers nested
subgraphs, reducers, artifact references, stream edges, and trace projection,
and the shared join proves X05/X08/X10 behavior. Production ArtifactStore,
distributed storage, OTel transport, and Explorer remain later tasks even when
their carriers are frozen here.

## 14. Durable execution, storage, leases, replay, and fork workstream

### 14.1 Authoritative event history

The event stream is the authoritative state machine. Checkpoints are validated
acceleration only. Complete durability with:

- immutable run creation binding graph, plan, input, implementations,
  policies, authority, pricing, provider configuration, and protocol versions;
- atomic expected-sequence append;
- globally unique run-local event identity;
- strict event type and phase transition validation;
- commit-before-dependent-release;
- exact attempt reservation before execution;
- result/terminal durability before downstream visibility;
- terminal idempotence;
- no successful committed node rerun;
- explicit interrupted-safe versus in-doubt-external-effect handling;
- bounded event payload and artifact indirection; and
- full corruption detection with no best-effort continuation.

### 14.2 Checkpoint acceleration

Checkpoint acceptance requires:

- event stream ID, through-sequence, history hash, graph/plan/revision hash,
  reducer/controller state, attempts, budgets, approvals, locks, artifacts,
  routes, seen sets, and lineage;
- canonical checksum and closed schema;
- reconstruction equality against the authoritative prefix;
- atomic replace and crash-safe persistence;
- rejection of future, stale, foreign-run, foreign-revision, or substituted
  checkpoints;
- fallback to full fold when missing or invalid; and
- no deletion or mutation of authoritative events during compaction.

Checkpoint tests crash before write, during temp write, before rename, after
rename, and during concurrent resume.

### 14.3 Lease and fencing protocol

Define a portable `LockManager`/lease contract with:

- resource key, owner, lease ID, monotonically increasing fence, acquired and
  expires timestamps, renewal limit, and policy identity;
- compare-and-swap acquire/renew/release;
- stale owner rejection at every event/artifact/checkpoint/patch commit;
- no reliance on wall clock alone for authority;
- bounded clock-skew assumptions and deterministic test clock;
- safe lease loss while external work is running;
- one durable winner in dual-resume races;
- structured loser events/errors; and
- adapter conformance for in-memory, SQLite, and PostgreSQL implementations.

### 14.4 Replay

Replay is a read-only fold:

- it accepts an exact run and optional through-sequence;
- validates all source identities and event history;
- emits no event, checkpoint, artifact mutation, lease operation, model call,
  tool call, provider call, random draw, or current-clock decision;
- reconstructs the exact allowed historical result/state/trace projection;
- preserves unknown/in-doubt facts;
- can render intermediate state for inspection; and
- returns structured corruption/version/unsupported errors.

Tests instrument every external adapter and assert zero calls/writes.

### 14.5 Fork

Fork creates a new run with explicit parent lineage:

- parent run, event stream, through-sequence, history hash, graph revision,
  artifact disposition, and authority are fixed;
- the parent is never mutated;
- reused state/results/artifacts are enumerated and integrity checked;
- changed graph/input/policy/authority becomes new identity;
- unsafe external effects are not reclassified as completed;
- stale approvals do not transfer unless an explicit authority policy allows a
  bound re-approval; and
- child events distinguish inherited facts from new work.

### 14.6 Storage implementations

Ship and test:

- in-memory deterministic stores for unit tests;
- JSONL/local-file stores for transparent development;
- SQLite as the default durable local backend;
- local content-addressed artifact storage;
- PostgreSQL for multi-worker coordination;
- S3-compatible artifact storage; and
- a portable adapter conformance kit covering EventStore, CheckpointStore,
  ArtifactStore, LockManager, metadata queries, transactions, and cleanup.

Each backend requires race tests, crash tests, corruption tests, namespace and
tenant isolation, bounded pagination, cancellation, timeouts, retries,
idempotency, migration, backup/restore, and explicit operational limits.

### 14.7 Distributed workers

Worker mode MUST preserve the single-node semantics:

- lease/fence before claim and before commit;
- content-addressed implementation/plan identity;
- bounded prefetch and concurrency;
- heartbeats that do not substitute for durable progress;
- cancellation and orphan recovery;
- no duplicate downstream release;
- artifact locality/cache integrity;
- provider/capability isolation;
- version-skew refusal when semantics differ; and
- deterministic coordinator decisions captured in events.

Chaos tests kill coordinators/workers at every claim/execute/commit/release
window and prove convergence without deadlock or unbounded spawning.

## 15. Redaction, privacy, approval, and capability security workstream

### 15.1 Truthful durable payload disposition

The existing false pattern “raw bytes plus `redacted: true`” is release
blocking. The new contract MUST ensure that every durable or export sink stores
exactly one truthful disposition:

- inline raw only when an explicit policy and authority permit it and the wire
  flag says raw;
- inline redacted with a receipt binding the exact transform/rules;
- protected/encrypted reference with correct key/AAD/authority identity;
- content-addressed artifact reference with sink policy; or
- omitted/tombstoned with an explicit reason.

No boolean label may claim protection that the bytes do not have.

### 15.2 Complete source and sink inventory

Maintain a machine-readable live inventory for, at minimum:

- graph input and output;
- node input and output;
- executor/model/tool request and response;
- event data;
- checkpoint state;
- artifacts and metadata;
- provider usage and errors;
- stdout/stderr;
- CLI human and JSON output;
- logs and structured errors;
- traces/spans/metrics attributes;
- MCP requests/responses;
- plugin communication;
- worktree/process/container output;
- support bundles;
- Explorer APIs and cached views;
- database indexes/materialized projections;
- export/replay/fork reports;
- backups/migrations/dead letters; and
- test/benchmark failure artifacts.

New code adding a source or sink MUST update this inventory and fail CI when no
capture/redaction/protection disposition exists.

### 15.3 Redaction rules and JSON Pointer semantics

Freeze exact RFC 6901 parsing and matching:

- valid escape sequences only;
- root, object, array, numeric-token, empty-key, slash, tilde, Unicode scalar,
  and duplicate/ancestor/descendant paths;
- no prototype-property traversal;
- no getters, proxies, custom mappings, or virtual model dispatch;
- deterministic rule order and overlap policy;
- maximum pointer count, token count, token bytes, value depth, value count,
  and transformed bytes;
- closed actions such as replace, hash, omit, protect, or artifact-reference;
- deterministic replacement tokens that cannot contain the secret; and
- receipts binding source hash, result hash, rule set, policy, implementation,
  registry, authority, and timestamp/event context.

### 15.4 Sink-before-write transaction

Every sink transaction follows:

1. capture an exact portable detached source;
2. resolve the effective closed policy and live rule registry;
3. authorize source-to-sink flow;
4. transform/protect in bounded memory;
5. verify the output disposition and canary exclusions;
6. generate a bound receipt;
7. atomically write payload plus receipt or write neither;
8. commit any event/checkpoint/index only after the protected sink write; and
9. on retry, use idempotency identity and never double-transform ciphertext or
   hash an already-replaced token as though it were raw.

Failures expose no partial raw bytes through temp files, errors, logs, events,
indexes, retries, or cleanup routines.

### 15.5 Native redaction implementations

TypeScript and Python each implement the complete contract independently and
integrate every current sink. Required tests include:

- positive redaction/protection cases;
- one negative seeded canary per source and sink;
- bypass attempts through derivatives, summaries, exceptions, filenames,
  metadata, hashes, snippets, binary encodings, nested artifacts, and support
  bundles;
- rule-registry mutation and stale-policy races;
- encryption/AAD/key/authority mismatch;
- cancellation or crash before/after transform and before/after sink commit;
- migration of legacy false-flag histories without silently trusting the flag;
- replay identity and no re-transformation drift;
- secret scan over journal, checkpoint, artifact, stdout, stderr, log, trace,
  error, database, export, and support bytes; and
- hostile input bounds and failure message scans.

The cross-language join retains raw seeded canaries only inside isolated test
inputs and proves every authorized protected output plus every intentionally
failing detector.

### 15.6 Approval authority

Human approval is a signed/bound state transition, not a free-form boolean.
Define:

- approval request ID, operation kind, exact canonical payload/action hash,
  graph/run/revision/attempt/activity identity, authority principal, policy,
  requested capabilities, expiry, nonce, and reason;
- approve, reject, revoke, expire, and supersede decisions;
- idempotent repeated delivery;
- stale graph/run/revision/payload/authority rejection;
- minimum separation of requester and approver where policy requires;
- durable event/checkpoint projection;
- replay preserving the historical decision without contacting a human;
- fork transfer rules; and
- CLI/MCP/UI surfaces that cannot broaden the authorized operation.

### 15.7 Capability policy

Every executable node receives an explicit capability manifest intersected
with graph, tenant, run, node, adapter, and deployment ceilings. Capabilities
are deny-by-default and cover:

- filesystem read/write/create/delete roots;
- worktree/repository operations;
- process execution, executable identities, arguments, environment, cwd,
  stdin/stdout/stderr, duration, and resource limits;
- network hosts, ports, protocols, redirects, DNS/IP policy, request/response
  bytes, and credentials;
- secret names and one-way injection rules;
- model/provider/account/model/tool permissions;
- MCP server/tool/resource operations;
- artifact namespaces and actions;
- database/storage operations;
- approval requirements; and
- dynamic patch authority.

A planner, prompt, model response, plugin, tool output, child subgraph, or patch
can narrow but never widen authority.

### 15.8 Privacy and consent

Telemetry, prompt capture, response capture, traces containing content,
gallery publication, adopter stories, and external study data are off by
default. Complete the privacy program with:

- explicit purpose and data-category inventory;
- opt-in controls separated by telemetry/capture/publication purpose;
- retention and automatic deletion schedules;
- user inspection/export/delete/withdrawal paths;
- consent receipts and versioned policy text;
- no hidden identifiers or provider data reuse;
- anonymization/pseudonymization limits documented honestly;
- support-bundle preview and redaction;
- external tester consent and failed-attempt retention policy; and
- independent review that default installs emit no telemetry network request.

### 15.9 Security completion gate

Security is Green only after threat modeling, code review, SAST, dependency and
license audit, SBOM, secret scans, property/fuzz tests, injection tests,
isolation escape tests, redaction canaries, package/install scans, live sink
inventory, privacy checks, and independent disposition show no unaccepted
high/critical issue. A historical source-alpha security review cannot satisfy
this candidate gate.

## 16. Budget, usage, pricing, model routing, and provider workstream

### 16.1 Portable budget units

Replace ambiguous floating-point accounting at the complete budget-contract
boundary with versioned portable units:

- wall/orchestration time in integer milliseconds or nanoseconds where host
  support is proven portable;
- attempts, nodes, edges, fan-out, depth, candidates, artifacts, bytes, tool
  calls, and provider calls as safe non-negative integers;
- input, output, cached, reasoning, image/audio, and provider-specific usage in
  closed integer fields;
- money in a versioned integer minor/nano currency unit with explicit ISO
  currency and no implicit USD conversion;
- carbon or other experimental metrics only in an extension namespace and
  never as release-critical truth without a contract; and
- every limit carrying inclusive/exclusive semantics and maximum protocol
  value.

No epsilon comparison or platform-local decimal type may change whether work
is admitted.

### 16.2 Durable reservations and settlement

Before work dispatch, reserve the sound worst case for every bounded resource.
The ledger MUST support:

- available, reserved, committed, released, compensated, and disputed states;
- unique reservation identity bound to run/node/attempt/activity/round/plan;
- atomic multi-dimension admission;
- nested subgraph and cycle child allocations that cannot exceed the parent;
- settlement from trusted provider/tool usage envelopes;
- timeout/cancel/failure handling;
- in-doubt external usage retained conservatively;
- idempotent retry and duplicate settlement rejection;
- lease/fence and event-stream CAS;
- checkpoint/replay/fork behavior;
- tenant/run/graph/node/provider/model ceilings; and
- deterministic terminal reason precedence when several limits become true.

Tests attack under-reservation, integer overflow, negative usage, duplicate
settlement, stale prices, currency mismatch, crash windows, concurrent spends,
clock jumps, fork credit reuse, and a provider reporting more usage than its
declared ceiling.

### 16.3 Pricing snapshots

Pricing is immutable input to a run, not a mutable global lookup:

- provider, account class, model/tool, region, currency, effective interval,
  unit schedule, cache/discount rules, source, and policy identity are recorded;
- remote pricing refresh happens outside an active decision;
- missing or ambiguous pricing blocks money-bounded work unless a conservative
  explicit ceiling is supplied;
- price changes create a new snapshot and never rewrite history;
- public cost output distinguishes estimated, reserved, provider-reported,
  reconciled, and unknown amounts; and
- documentation dates every illustrative price.

### 16.4 Model router

The model router uses a closed deterministic policy over declared metadata and
recorded classification results. It supports:

- capability requirements such as tools, JSON schema, images, context, or
  streaming;
- allowed providers/models/accounts/regions;
- quality tier and bounded fallback order;
- maximum input/output/context/usage/cost/time;
- data residency and privacy restrictions;
- rate/circuit health from recorded adapter state;
- explicit session/default inheritance resolved before persistence;
- cheaper repetitive-node routing and higher-judgment merge/judge routing;
- deterministic mock routes in normal CI; and
- route decision events reused on replay.

A model response cannot select a model outside its authority ceiling. Fallback
cannot bypass privacy, tool, capability, budget, or approval policy.

### 16.5 Provider and tool adapter contract

Every official adapter implements a common versioned contract for:

- request identity and idempotency metadata;
- bounded input, output, tools, attachments, and streaming frames;
- structured provider response, usage, finish reason, safety outcome, and
  provider request ID;
- timeout, cancellation, retryability, rate limit, circuit breaker, fallback,
  and backoff hints;
- normalized error taxonomy with retained provider-safe details;
- tool-call validation before execution;
- redaction/protection at request, response, log, trace, and support sinks;
- capability and approval enforcement;
- deterministic fake behavior and fault injection;
- capture opt-in and retention disposition; and
- version/account/model compatibility reporting through `doctor`.

Official model adapters SHOULD cover the providers deliberately selected by the
project only after the vendor-neutral mock and HTTP contracts pass. Breadth of
vendor logos is lower priority than semantic consistency, security, and useful
failure handling.

### 16.6 HTTP, shell, and MCP adapters

HTTP adapters require allowlisted scheme/host/port, DNS/IP rebinding defenses,
redirect re-authorization, request/response byte bounds, timeout/cancel,
header/credential isolation, TLS policy, redacted logs, and deterministic
fixtures.

Shell adapters require an explicit executable identity, argument vector,
working directory, environment allowlist, stdin policy, output limits,
duration/CPU/memory/process limits, signal/cancel behavior, no implicit shell
expansion, and isolated filesystem/process providers where configured.

MCP adapters are read-only by default. Mutation requires exact server/tool,
schema, capability, policy, approval, budget, timeout, output, redaction, and
idempotency gates. Tool descriptions or model-generated arguments never grant
authority.

### 16.7 Adapter conformance

The shared adapter kit exercises deterministic success, streamed success,
tools, structured output, usage, malformed output, rate limit, retry-after,
timeout, cancellation, fallback, circuit open/half-open/close, credential
redaction, prompt injection, oversized frames, provider disconnect, duplicate
frames, late frames, and support-bundle export. TypeScript and Python normalize
the same mock wire traffic to identical portable envelopes.

Opt-in live tests are quarantined, budget-limited, secret-safe, non-release
blocking when provider availability is external, and retained separately from
the deterministic candidate gate.

## 17. Verification, reflection, citations, and judge-panel workstream

### 17.1 Versioned rubric

A rubric is a closed content-addressed contract containing:

- rubric ID/version/hash;
- claim/output schema under review;
- ordered criteria with severity and evidence requirements;
- allowed verdicts and confidence representation;
- pass/reject/abstain/unknown thresholds;
- quorum and tie behavior;
- citation/reproduction requirements;
- model/tool/capability/budget ceiling;
- maker/verifier independence policy; and
- migration/deprecation rules.

Free-form “looks good” review cannot satisfy a release gate.

### 17.2 Reflection node

Reflection compares a producer output to the exact rubric and emits structured
issues, evidence, suggested changes, and a verdict. It MUST:

- preserve the original output and rubric identity;
- never silently edit the accepted result;
- separate deterministic checks from model judgment;
- declare whether the same model/context is permitted;
- cap revisions and cost;
- record every attempt and terminal decision;
- surface unknown when required evidence is missing; and
- stop without infinite self-critique.

### 17.3 Adversarial and perspective-diverse verification

Support independent verifier panels with distinct lenses such as correctness,
security, reproducibility, performance, compatibility, evidence/citation, and
operability. Each vote contains:

- verifier/rubric/model/tool identities;
- exact claim/finding hash;
- verdict, confidence, issues, evidence references, and reproduction result;
- usage/cost/timing;
- abstain/unknown reason; and
- maker/verifier separation proof where required.

Majority alone is insufficient when quorum is not met. Missing, failed, or
abstaining verifiers remain visible and cannot be filtered away before the
gate.

### 17.4 Judge panels and synthesis

Judge panels compare multiple candidates without erasing runners-up:

- candidates are frozen before judging;
- each judge sees the declared comparison set and rubric;
- scores and rankings are structured and normalized;
- conflicts, ties, abstentions, and insufficient evidence are retained;
- deterministic aggregation happens in code;
- synthesis can graft cited strengths only with traceable source references;
- the selected result records all candidate and vote hashes; and
- replay uses the recorded decision without new judgment.

### 17.5 Citation verification

Claims requiring citation pass a dedicated verifier that:

- identifies the exact claim span/structured claim ID;
- binds source URL/document/artifact identity, retrieval time, content digest,
  and permitted excerpt;
- checks source existence, relevance, entailment, freshness, authority, and
  contradiction;
- distinguishes direct support from inference;
- detects citation laundering, circular references, fabricated URLs, stale
  versions, and source-text mismatch;
- respects copyright and privacy limits; and
- emits supported, contradicted, insufficient, or inaccessible rather than
  inventing evidence.

Normal CI uses frozen local sources. Optional network verification is bounded
and its external availability is reported honestly.

### 17.6 Verification conformance

Shared cases cover pass, reject, abstain, unknown, missing quorum, tie, stale
rubric, maker/verifier identity collision, citation support/contradiction,
reproduction success/failure, judge conflict, revision limit, budget stop,
cancellation, crash/resume, and replay with zero new provider calls. Every vote
and evidence reference survives events, checkpoints, exports, and the Explorer.

## 18. Isolation, worktrees, processes, containers, and merge workstream

### 18.1 Isolation provider interface

Define a common provider contract for:

- allocate with exact image/runtime/repository/base/capability/resource policy;
- execute structured commands/activities;
- bounded file/artifact exchange;
- inspect health/status/output;
- cancel/terminate;
- collect redacted diagnostics;
- release/cleanup idempotently; and
- prove no namespace remains after cleanup.

Providers include no-op/local deterministic tests, Git worktree, restricted
process, and container implementations. Documentation states the actual trust
boundary of each provider.

### 18.2 Git worktree provider

The worktree provider requires:

- exact repository object identity and clean/dirty policy;
- base commit, branch/ref naming, detached versus branch mode;
- exclusive lease and path outside protected broad directories;
- no symlink/submodule/path escape;
- sparse or filtered checkout behavior declared explicitly;
- per-node branch/commit identity;
- tests/build commands as structured gates;
- artifact/diff manifest and size bounds;
- merge/rebase/cherry-pick policy;
- conflict representation as structured failure;
- preservation for debugging when authorized;
- cleanup that never removes unrelated user work; and
- recovery after process crash or stale lease.

Parallel agents never share a writable worktree. A merge node consumes immutable
commits/diffs and gate reports, not a mutable directory.

### 18.3 Process isolation

Restricted process execution defines:

- executable and argv allowlist;
- exact cwd and filesystem roots;
- sanitized environment and secret injection;
- UID/GID or platform-equivalent boundary where available;
- process group/session control;
- CPU, memory, open-file, process-count, output-byte, temp-byte, and duration
  limits;
- network namespace/policy where supported;
- stdin/stdout/stderr framing and truncation receipts;
- signal escalation and zombie cleanup; and
- structured unsupported-platform diagnostics.

### 18.4 Container isolation

Container execution adds:

- immutable image digest and provenance;
- non-root user, read-only root filesystem, dropped capabilities, seccomp or
  platform sandbox profile, no privileged mode, and explicit mounts;
- network disabled by default and allowlisted egress when needed;
- CPU/memory/PID/disk limits;
- secret mounts with lifecycle controls;
- port and namespace isolation;
- image/package vulnerability gate;
- log/artifact redaction; and
- force-stop and garbage-collection recovery.

Container availability does not itself prove safety; configuration and escape
tests are candidate evidence.

### 18.5 Safe merge gate

Merge is a first-class deterministic/human-gated node:

- verify base ancestry and expected source commits;
- reject unrelated dirty state or altered generated files;
- apply the declared merge strategy;
- retain conflicts without destructive cleanup;
- run exact lint/type/test/build/security/package gates;
- enforce ownership and protected-path policy;
- require approval for policy-defined changes;
- create a signed or attributable commit with exact message/trailers policy;
- emit artifact/diff/test identities; and
- never push/merge externally without explicit workflow authority.

### 18.6 Isolation red-team campaign

Attack path traversal, symlink/hardlink races, `.git` indirection, submodules,
hooks, environment injection, shell metacharacters, executable replacement,
port collision, temp/cache/database namespace collision, process escape,
container mount/privilege/network escape, secret exfiltration, prompt-injected
capability requests, stale leases, merge conflicts, cleanup races, and hostile
support output. Run on Linux, macOS, and Windows where the provider is claimed.

## 19. SDK, CLI, MCP, plugin, and developer-experience workstream

### 19.1 Stable SDKs

TypeScript and Python SDKs expose equivalent public concepts:

- Graph IR models and builders;
- safe JSON/YAML loading;
- compile/plan and structured diagnostics;
- run/start/resume/replay/fork/cancel APIs;
- cycle, router, barrier, verifier, budget, approval, artifact, trace, adapter,
  storage, and isolation contracts;
- event/checkpoint/result envelopes;
- plugin/adapter interfaces;
- deterministic mock helpers; and
- explicit async, cancellation, context-manager/disposal behavior.

Public exports are enumerated, documented, semver-classified, and tested from
packed artifacts. Hidden source paths are not part of the API.

### 19.2 Complete CLI command matrix

Implement and test, in both native paths where applicable:

- `init`, `add`, `validate`, `compile`, `plan`, and `run`;
- `status`, `watch`, `inspect`, and `logs`;
- `pause`, `resume`, `cancel`, and `retry`;
- `replay` and `fork`;
- `cost`, `doctor`, `score`, `badge`, `visualize`, and `pick`;
- `artifact` list/show/verify/export;
- `worktree` inspect/cleanup/recover;
- `plugin` and `adapter` list/doctor/scaffold;
- `mcp` serve/doctor/configure with read-only default;
- `events`, `checkpoint`, and `support-bundle` safe inspection;
- `migrate` and compatibility diagnosis; and
- version/help/completion/config commands.

Every command has stable JSON mode, human mode without terminal injection,
stdout/stderr separation, exit-code reference, cancellation, signal handling,
configuration precedence, no-secret errors, and installed-artifact tests.

### 19.3 Graph Ready score

The deterministic G0-G4 score is a transparent rules engine, not an LLM grade.
It evaluates:

- graph contract quality;
- boundedness and resource budgets;
- durability and external-effect safety;
- failure and cancellation semantics;
- verification/quorum quality;
- capability/isolation policy;
- redaction/privacy posture;
- observability and support readiness;
- cross-language/package compatibility; and
- production/release evidence.

Output includes exact rule IDs, evidence, score, level, exclusions, and top
three remediation actions. A badge binds the graph/plan/rule-set hash and
cannot imply runtime or release certification it did not test.

### 19.4 Pattern picker

The picker asks deterministic questions about topology, data dependencies,
unknown discovery size, side effects, durability, verification, isolation,
latency, cost, provider/tool use, and human approval. It recommends one or more
patterns, explains rejected alternatives, emits a bounded scaffold, and links
failure/operations/safety guidance. It never enables authority or a provider by
default.

### 19.5 Plugin SDK

Plugins use a versioned manifest with:

- name/version/protocol/API compatibility;
- entrypoints and package/artifact identity;
- provided node kinds/adapters/tools/reducers/renderers;
- required capabilities and approvals;
- schemas/configuration/default policy;
- resource limits and isolation requirement;
- licensing/provenance/security metadata;
- deterministic mock and conformance tests; and
- enable/disable/migration/uninstall behavior.

Discovery is explicit and allowlisted. Loading arbitrary code from the current
directory, package postinstall scripts, or model output is forbidden.

### 19.6 Runtime MCP surface

Keep schema/validate/plan tools read-only and add runtime mutation only behind
explicit configuration, capability, approval, candidate identity, budget,
redaction, and idempotency. MCP operations return the same stable envelopes and
errors as CLI/SDK. Hostile tool descriptions, prompt injection, oversized
arguments, stale approvals, and duplicate requests fail closed.

### 19.7 Developer experience acceptance

From clean machines and packed artifacts:

- Quickstart uses at most three commands and no provider credential;
- both language paths reach a deterministic successful graph;
- errors name the top useful remediation without exposing internals/secrets;
- generated projects contain no mutable network dependency for first success;
- documentation snippets execute;
- shell completion/help/version work;
- upgrade/migration failures are actionable; and
- external testers complete the same flow under the required threshold.

## 20. Observability and Graph Explorer workstream

### 20.1 Event/log/metric/trace exporters

Implement JSONL, structured console, and OpenTelemetry exporters over the
public normalized trace contract. Exporters MUST:

- be off by default where telemetry leaves the process;
- apply sink-before-write redaction/protection;
- have bounded queues and explicit drop/backpressure policy;
- never block durability commits indefinitely;
- propagate cancellation and flush with bounded timeout;
- expose dropped/export-failed counters without recursive logging storms;
- preserve run/node/attempt/edge/artifact/controller lineage;
- use semantic conventions versioned by the project; and
- support deterministic in-memory exporters for tests.

### 20.2 Derived metrics

Provide exact definitions for:

- run and node latency;
- queue, barrier, approval, retry, backpressure, provider, storage, and merge
  wait;
- critical path;
- available versus used parallelism;
- worker utilization;
- attempts, failures, cancellations, retries, dead letters, unknowns, and
  quorum shortfalls;
- token/usage/cost reservations and settlement;
- checkpoint/recovery/replay/fork counts;
- artifact and stream bytes;
- model/provider/tool distributions; and
- time to first result and first successful run.

Metrics derived from sampled/incomplete telemetry are labeled accordingly.

### 20.3 Explorer backend

The Explorer API reads through a bounded query service rather than direct
database access. It supports:

- run/search/status summaries;
- topology and revision history;
- event pagination with stable cursors;
- node/attempt/activity detail;
- state and checkpoint time travel;
- replay/fork comparison;
- artifact metadata and authorized preview;
- stream/backpressure views;
- budget/cost and critical-path analysis;
- verifier votes/citations and approval history;
- worker/lease/storage diagnostics; and
- redacted support-bundle export.

Every endpoint enforces tenant/run/artifact authority, pagination/byte/time
limits, redaction, cache identity, cancellation, and structured errors.

### 20.4 Explorer frontend

The React application includes:

- scalable DAG/subgraph/controller topology;
- status coloring with accessible non-color indicators;
- edge modes and data identities;
- timeline and critical path;
- event/checkpoint time travel;
- run/replay/fork diff;
- budget/cost/usage panels;
- barrier/router/verifier/approval detail;
- artifact and stream panels;
- worker/storage health;
- known-limit and incomplete-data banners;
- keyboard navigation, screen-reader labels, reduced-motion support, and
  responsive layouts; and
- no raw prompt/secret display without explicit authorized capture.

Frontend tests cover large graphs, hostile labels, Unicode, long errors,
partial histories, disconnected live updates, permission denial, redaction,
and deterministic screenshots.

### 20.5 Live update protocol

Use bounded resumable SSE or WebSocket delivery with:

- authenticated subscription scope;
- sequence/cursor and gap detection;
- reconnect from a durable cursor;
- backpressure/drop policy;
- heartbeat distinct from progress evidence;
- no event reordering within a stream;
- snapshot-plus-delta consistency;
- redaction before serialization; and
- resource limits per connection and tenant.

### 20.6 Explorer acceptance

Explorer Green requires installed backend/frontend artifacts, multiple storage
backends, both native runtimes, live and historical runs, accessibility checks,
security review, performance bounds, redaction canaries, and external usability
evidence. Static Mermaid/DOT output remains useful but cannot satisfy this gate.

## 21. Ten complete executable pattern bundles

### 21.1 Common Pattern Bundle contract

Every pattern ships one machine-readable manifest binding:

- pattern ID, version, title, intent, non-goals, and maturity;
- canonical YAML and JSON graphs;
- native TypeScript and Python launcher/source examples;
- deterministic fixtures, fake adapters, expected events/checkpoints/results,
  canonical identities, and failure cases;
- optional real-provider/tool setup isolated from normal CI;
- topology, sequence, recovery, authority, and data-flow diagrams;
- budget, model-routing, capability, approval, redaction, privacy, retention,
  artifact, storage, and isolation policy;
- normal, retry, timeout, cancellation, crash/resume, replay/fork, and terminal
  demonstrations where applicable;
- unit, integration, cross-language, packed-install, and end-to-end commands;
- CLI, SDK, Claude Code, Codex, MCP, and shell usage guides;
- operational runbook, observability queries, common failures, rollback, and
  support-bundle instructions;
- security/threat notes and prompt-injection examples;
- tested version and exact known limitations; and
- immutable evidence and independent review.

The bundle checker rejects missing languages, launchers, tests, expected
events, diagrams, budgets, permissions, failure/recovery paths, docs, or
candidate identity. A static constructor is not a complete bundle.

### 21.2 Pattern 01 — multi-source research diamond

Implement:

- scoped question decomposition into independent source jobs;
- source-specific authority and network policy;
- parallel fan-out with bounded concurrency and per-source time/cost limits;
- deterministic flatten/filter/deduplicate edge transforms;
- source/content identity and retrieval metadata;
- partial-source failure retention;
- a real fan-in barrier only where cross-source comparison is necessary;
- synthesis with claim-to-source references;
- citation and contradiction verification;
- resume without re-fetching committed sources;
- replay with zero network/provider calls; and
- trace visualization of parallelism versus barrier wait.

Negative cases include duplicate sources, malicious source content, citation
laundering, stale data, rate limits, one source timeout, all sources empty,
oversized documents, cost stop, and cancellation during synthesis.

### 21.3 Pattern 02 — cited deep research

Extend Pattern 01 with:

- claim extraction and stable claim IDs;
- per-claim primary-source preference policy;
- multiple independent search angles;
- fetch/content hashing and source version retention;
- adversarial skeptics trying to refute each claim;
- supported/contradicted/insufficient/inaccessible outcomes;
- short copyright-safe evidence excerpts;
- final prose generated only from accepted claim records;
- explicit inference labels;
- citation coverage and unsupported-claim gate; and
- an exportable evidence table.

Tests include fabricated URLs, changed pages, circular citations, irrelevant
sources, contradictory authoritative sources, inaccessible sources, and a
claim that must be omitted rather than hallucinated.

### 21.4 Pattern 03 — route authentication security sweep

Implement:

- deterministic repository/route discovery in an isolated worktree;
- one bounded analysis job per route or route group;
- framework-aware auth/authz contract inputs;
- deny-by-default capability policy;
- findings containing file/range/rule/evidence/reproduction/severity;
- independent security and reproduction verifiers;
- deduplication by stable finding identity;
- false-positive retention and disposition;
- optional safe patch proposal separated from acceptance;
- merge/test/security gate with approval; and
- a final report that never claims exploitability without evidence.

Attack fixtures include aliases, generated routes, middleware order, inherited
guards, public-route declarations, path traversal, prompt injection in source
comments, binary/oversized files, symlinks, and parallel write attempts.

### 21.5 Pattern 04 — diff risk router and judge panel

Implement:

- immutable base/head diff identity;
- deterministic size/surface/language/security classification;
- low-risk quick path and high-risk diverse parallel review path;
- correctness, security, performance, compatibility, tests, and operability
  lenses;
- structured findings and retained abstentions;
- reproduction/test activities in isolated worktrees;
- judge panel with explicit rubric and conflicts;
- final synthesis preserving every accepted source finding;
- no model authority to merge or push; and
- replay using recorded classification/judgment.

Cases cover huge/binary/generated diffs, rename/copy, submodules, deleted tests,
secret material, dependency lock changes, prompt injection, flaky tests, and
insufficient reviewer quorum.

### 21.6 Pattern 05 — loop-until-dry discovery

Implement the full dynamic cycle runtime:

- multiple finder roles/lenses;
- global durable seen set including rejected/unknown findings;
- ordered candidates and stable keys;
- independent verification and quorum;
- accepted/false-positive/unknown disposition;
- dry-round convergence;
- hard iteration, time, cost, attempt, discovery, candidate, and dynamic-node
  limits;
- optional GraphPatch expansion through all gates;
- crash/resume/replay/fork; and
- explicit exit reason and unevaluated count.

The core regression proves that rejected findings do not reappear forever and
that two configured dry rounds terminate deterministically.

### 21.7 Pattern 06 — file-by-file migration

Implement:

- deterministic file/module dependency partitioning;
- one isolated worktree per safe parallel unit;
- language/framework-specific translation contract;
- bounded tool/model permissions;
- compilation, unit, integration, formatting, static, security, and behavior
  gates;
- adversarial review per unit;
- dependency-aware merge order;
- structured conflict and rollback;
- failure loop with attempt/cost limits;
- resume reusing committed successful units; and
- final whole-repository compatibility comparison.

Never claim semantic equivalence solely from compiling. Include golden behavior,
API, performance, and failure cases.

### 21.8 Pattern 07 — CI failure sweeper

Implement:

- immutable CI run/check/job/log identity;
- failure classification without changing external state;
- deduplication of shared root causes;
- isolated reproduction with pinned dependencies;
- bounded fix proposals;
- test and security gates;
- approval before external push/rerun/merge;
- idempotent operations and stale-run rejection;
- handling of flaky/external/infrastructure failures; and
- watch/resume until a terminal authorized outcome.

Tests prevent endless reruns, duplicate comments, stale fixes, secret leakage
from logs, prompt injection, broad destructive commands, and unauthorized CI
mutation.

### 21.9 Pattern 08 — dependency update sweeper

Implement:

- ecosystem/manifest/lockfile discovery;
- advisory, compatibility, license, maintenance, and provenance inputs;
- dependency graph partitioning and safe update grouping;
- version-policy and prerelease controls;
- isolated lockfile/update generation;
- full tests, type, build, security, license, SBOM, and package gates;
- changelog/migration synthesis with citations;
- rollback and conflict handling;
- approval/merge policy; and
- scheduled resume without redoing accepted updates.

Cases include compromised packages, typosquats, removed versions, peer conflicts,
platform-specific locks, transitive-only advisories, license changes, stale
advisory data, and no-fix outcomes.

### 21.10 Pattern 09 — durable PR babysitter

Implement:

- exact repository/PR/head/base/check identities;
- polling/webhook deduplication;
- status/watch/inspect/log aggregation;
- review-thread and requested-change state;
- CI failure classification and bounded fix handoff;
- stale head and force-push handling;
- approval authority for comments, pushes, reruns, resolution, and merge;
- idempotent external operations;
- cancellation and timeout; and
- durable resume across long waits.

The pattern preserves user work, never bypasses branch protection, never merges
without explicit authority, and records every external mutation result.

### 21.11 Pattern 10 — scheduled ecosystem scan

Implement:

- versioned source inventory for releases, blogs, repositories, discussions,
  advisories, papers, and package registries;
- per-source adapters and privacy/network limits;
- scheduled run identity and overlap lease;
- parallel fetch with bounded rate/cost;
- deterministic normalization/deduplication;
- impact and relevance classification;
- cross-source verification;
- barrier only for global ranking/comparison;
- digest synthesis with exact source dates/links;
- checkpoint/resume and retained last-success metadata; and
- no-change/partial-failure/late-source behavior.

Cases cover source outages, duplicate syndication, future/incorrect dates,
malicious content, pagination loops, rate limiting, huge feeds, stale caches,
and schedule overlap.

### 21.12 Pattern roll-up gate

`CTRL-PATTERNS-071` runs every pattern from packed artifacts with no ambient
provider credential, compares both native runtimes, validates every manifest
field, exercises at least one failure and one recovery route, scans for canaries,
checks diagrams/docs links, and binds reports to one candidate. All ten must
pass; nine of ten is Open, not Partial Green.

## 22. Executable fourteen-step course and documentation workstream

### 22.1 Course module contract

Every module contains:

- learning objective and prerequisites;
- one conceptual diagram;
- one smallest working graph;
- YAML/JSON plus TypeScript/Python source;
- deterministic fixture and expected output/events;
- one common incorrect implementation;
- one failing test that exposes the error;
- one repaired implementation;
- performance/cost/security/durability implications;
- CLI/SDK/MCP/shell launch instructions;
- exercises and machine-checkable solution; and
- version/known-limit references.

### 22.2 Fourteen course modules

1. **Nodes and real data edges:** distinguish dependency from typing order and
   draw values crossing edges.
2. **Linear chain as a degenerate graph:** remove fake edges and compare
   critical path.
3. **Closed node contracts:** structured input/output, validation, failures,
   capability, and budget.
4. **Edges as deterministic plumbing:** transforms, dedupe, artifacts, streams,
   and why not every combine needs a model.
5. **Fan-out:** bounded native parallelism, partial failure, cancellation, and
   resource accounting.
6. **Fan-in and barriers:** true cross-item dependency, quorum/deadline, missing
   statistics, and false-barrier detection.
7. **Diamond topology:** split, independent work, deterministic reduce, and
   judgment synthesis.
8. **Runtime routing:** exhaustive conditional edges, durable decision, replay,
   and confidence escalation.
9. **Verification:** reflection, adversarial/diverse review, votes, quorum,
   citations, judges, and unknown.
10. **Isolation:** worktrees, processes, containers, capabilities, approvals,
    merge gates, and at-least-once effects.
11. **Convergent cycles:** global seen, dry rounds, hard limits, GraphPatch,
    recovery, and no infinite rediscovery.
12. **Model tiering and budgets:** portable usage/cost, reservations, router,
    fallback, and privacy.
13. **Topology as latency/cost:** pipeline versus barrier, critical path,
    backpressure, worker utilization, and measurement.
14. **Safe self-routing:** planning a graph at runtime while preserving compiler,
    policy, budget, authority, verifier, and human gates.

Add a fifteenth optional chapter, **When not to use a graph**, covering simple
one-step work, overhead, observability burden, unsafe side effects, unverifiable
parallelism, and situations where deterministic code is sufficient.

### 22.3 Documentation information architecture

Ship and continuously test:

- README and Chinese README;
- Quickstart and Chinese Quickstart;
- concepts and glossary;
- Graph IR, schemas, compiler, scheduler, cycles, durability, budget,
  verification, isolation, adapters, observability, and security references;
- CLI and both SDK API references;
- MCP and plugin guides;
- storage/worker deployment and operations;
- all pattern guides;
- failure modes and troubleshooting;
- migration and compatibility;
- privacy, telemetry, capture, retention, and support-bundle policy;
- threat model and secure deployment;
- performance and benchmark methodology;
- contribution architecture and test guides;
- release/provenance verification;
- course/case studies/demos; and
- exact known limitations for every release.

### 22.4 Documentation correctness

CI validates links, anchors, generated schema/API references, JSON/YAML/code
snippets, shell commands, package names, versions, hashes, CLI help, diagram
syntax, bilingual version/limitation consistency, claim-to-spec mappings, and
prohibited overclaim phrases. Snippets run against packed artifacts where
possible. Network-dependent links are monitored separately so an outage does
not hide a broken local reference.

### 22.5 Case studies and demos

Produce at least four authentic case studies:

- one research/knowledge graph;
- one code/security graph;
- one durable migration or operations graph;
- one honest failure or no-go story.

Each includes original objective, topology rationale, exact version/config,
fixtures or privacy-safe source data, trace, cost/latency, failure/recovery,
security/privacy boundary, reproducible steps, limitations, and outcome. The
90-second uncut demo starts from a clean environment and cannot hide setup,
errors, provider credentials, or edited elapsed time.

## 23. Candidate-level quality engineering workstream

### 23.1 Test taxonomy

Maintain separate, attributable suites for:

- schema meta-validation and duplicate-key parsing;
- protocol positive/negative fixtures;
- native TypeScript unit tests;
- native Python unit tests;
- compiler and runtime integration tests;
- cross-language behavioral conformance;
- persistence/storage adapter conformance;
- provider/tool adapter conformance;
- isolation provider tests;
- CLI/SDK/MCP/plugin installed-artifact tests;
- property and model-based state-machine tests;
- fuzz and parser differential tests;
- deterministic fault injection;
- randomized chaos with retained seeds;
- performance and resource benchmarks;
- security/red-team/canary tests;
- OS/runtime compatibility;
- upgrade/migration/rollback tests;
- package/provenance verification;
- documentation/snippet/link checks; and
- external usability acceptance.

Each report names exactly which class it proves. Aggregate test count cannot
hide a missing class.

### 23.2 Coverage thresholds

Against one candidate, measure statements and branches separately for:

- canonical serialization and hashing;
- Graph IR model/schema validation;
- compiler passes and diagnostics;
- scheduler and failure policies;
- pipeline/router/barrier;
- cycle/GraphPatch controller;
- durable event/checkpoint fold;
- storage/lease/artifact operations;
- budget ledger and model router;
- redaction/capability/approval policy;
- verifier/judge/citation logic;
- adapters and isolation providers; and
- CLI machine-envelope/exit mapping.

Compiler, scheduler, event store, and policy stay at or above 90% statements
and 85% branches. Security-critical code SHOULD exceed those values and requires
mutation/negative evidence, because line coverage alone is weak. Exclusions are
listed by file/branch with reviewer approval; generated schemas and unreachable
platform guards are not silently excluded.

### 23.3 Property and model-based testing

Generate bounded reproducible cases for:

- graph construction, canonicalization, compile idempotence, and diagnostic
  order;
- ready-queue scheduling under arbitrary DAGs;
- route/barrier/quorum algebra;
- pipeline backpressure and bounded in-flight invariants;
- event/checkpoint fold equivalence;
- lease and reservation state machines;
- cycle convergence/seen/idempotent patch decisions;
- reducer laws;
- artifact identities;
- redaction pointer/rule transformations;
- approval/capability intersection;
- budget conservation;
- verifier quorum and unknown outcomes; and
- migration round trips.

Every generated failure retains seed, minimized input, environment, and exact
reproduction command.

### 23.4 Fuzzing

Fuzz:

- JSON and safe YAML source loaders;
- canonical number/string/key handling;
- schemas, pointers, diagnostics, and extension maps;
- GraphPatch/event/checkpoint/approval/provider frames;
- CLI argv/config/environment and terminal rendering;
- MCP/plugin/provider/network framing;
- artifact/archive/package parsers;
- database/store migration and corrupt histories; and
- Explorer/API inputs.

Fuzzers enforce memory/time/depth limits and run sanitizers where supported.
Crashes, hangs, unbounded allocations, secret reflection, and divergent
TS/Python verdicts are P0/P1 depending on exposure.

### 23.5 Deterministic fault injection

Instrument every important boundary:

- before/after event append;
- before/after checkpoint write/rename;
- before/after lease acquire/renew/release;
- before/after budget reserve/settle/release;
- before/after activity dispatch/result;
- before/after route/barrier/verifier/approval decision;
- before/after artifact temp/finalize/index;
- before/after redaction/protection/sink write;
- before/after patch dry-run/CAS/decision;
- before/after worktree allocate/commit/merge/cleanup;
- provider stream connect/frame/finalize; and
- worker claim/execute/commit/downstream release.

For each injection assert terminal or resumable state, retained evidence,
resource cleanup, exact attempt/cost counts, and no unauthorized downstream
release.

### 23.6 Chaos campaign

Run at least 100 reproducible randomized campaigns spanning:

- process kill and crash;
- worker/coordinator loss;
- store latency/error/corruption;
- network disconnect/timeout/partition/rate limit;
- artifact upload/download corruption;
- clock jumps and deadline races;
- cancellation storms;
- non-cooperative executors;
- provider malformed/late/duplicate frames;
- lease expiry and dual resume;
- budget contention;
- disk/full/temp cleanup;
- worktree/merge conflicts; and
- Explorer/export backpressure.

Success means no deadlock, unbounded spawn/retry/memory/disk growth, budget or
authority escape, duplicate downstream advance, silent corruption, or secret
leak. A timeout without an explained bounded terminal state is not a pass.

### 23.7 Performance baselines

Version benchmark inputs and record warmup, repetitions, hardware, OS, runtime,
tool versions, CPU, memory, disk/network configuration, confidence statistics,
and raw reports. Measure:

- compile time/memory for small, 1,000-node, and maximum-bound graphs;
- scheduler throughput and ready-queue overhead;
- fan-out latency versus concurrency;
- pipeline throughput/latency/memory/backpressure;
- event append and checkpoint fold/recovery;
- SQLite/PostgreSQL/S3 operations;
- cycle rounds and large seen sets;
- canonicalization/hashing;
- redaction/protection;
- artifact ingest/read;
- worker scaling;
- trace/export and Explorer queries; and
- installed Quickstart time.

A regression above 10% blocks merging unless an ADR documents measurement,
cause, accepted tradeoff, owner, and expiry/revisit. Benchmark improvements may
not weaken validation, durability, security, or determinism.

### 23.8 Portability matrix

Candidate CI and release rehearsal cover:

- Linux, macOS, and Windows;
- x64 and arm64 where packages claim support;
- Node 20 and 22;
- Python 3.11, 3.12, and 3.13;
- filesystem case sensitivity, Unicode paths, long paths, permissions, symlinks,
  signals, process groups, temp paths, and line endings;
- shell absence/PowerShell differences without relying on ambient Bash;
- SQLite differences and optional PostgreSQL/S3 service matrices;
- container provider only on supported hosts with explicit skips elsewhere;
- packed npm and wheel/sdist installation in clean environments; and
- both `graph` and `grapheng` commands without PATH ambiguity.

An unsupported platform is documented and excluded before release; it is not a
green job hidden behind a broad skip.

### 23.9 Flake policy

No test is silently retried into Green. A retry records every attempt. Known
flakes have an issue, owner, reproducer, frequency, quarantine scope, expiry,
and release disposition. Security, durability, conformance, package identity,
and release-roll-up gates cannot be quarantined for stable release.

## 24. Packaging, distribution, provenance, and upgrade workstream

### 24.1 TypeScript package topology

Publish deliberate public packages with stable exports, including the
appropriate subset of:

- canonical core/IR/compiler;
- runtime;
- persistence/storage;
- primitives;
- patterns;
- adapters;
- isolation;
- observability/client;
- plugin SDK;
- MCP server;
- CLI; and
- canonical unscoped `graph-engineering` distribution with `graph` and
  `grapheng` binaries.

Every tarball has an allowlist, no source/test/secret/cache/workspace leakage,
no unresolved workspace dependency, correct license/README/types/exports/bin,
deterministic build metadata, and clean consumer import/execution smoke.

### 24.2 Python package topology

The Python distribution includes only reviewed runtime/SDK/CLI/schema assets,
supports the declared Python matrix, installs without the repository, exposes
both console aliases, has correct typing markers and package data, and passes
wheel and sdist reproducibility/content checks. Build isolation cannot fetch
undeclared or mutable dependencies.

### 24.3 Trusted publication

Use short-lived trusted publishing/OIDC where registries support it:

- protected environment and exact workflow identity;
- immutable source tag/commit;
- required candidate gates and manual approval policy;
- no long-lived registry token in routine CI;
- package name/namespace ownership verified;
- staging or non-publishing rehearsal before stable tags;
- expected package/version absent/present checks preventing overwrite;
- idempotent failure handling; and
- publication result/digest captured from the registry.

Agents may prepare and rehearse but cannot invent unavailable registry authority.

### 24.4 SBOM, checksums, and attestations

Produce:

- source archive checksum;
- every npm tarball checksum;
- wheel and sdist checksums;
- container/image checksums where released;
- SPDX or CycloneDX SBOMs with direct/transitive dependencies and licenses;
- build provenance/attestation linking source, workflow, builder, materials, and
  outputs;
- signatures where project policy selects a maintained mechanism; and
- a verification manifest and documented offline/online commands.

Independent verification downloads released artifacts from public registries
and proves the manifest rather than trusting local build paths.

### 24.5 Dependency and license policy

Pin or bound dependencies deliberately, scan lockfiles and packed artifacts,
review install scripts/native binaries, reject known high/critical advisories
without disposition, maintain license allow/deny/review lists, produce notices,
and handle optional provider SDKs so they do not burden deterministic/core
installs. Dependency-review policy applies to generated lock changes and
transitive replacements.

### 24.6 Versioning and compatibility

Define semver for:

- Graph IR/protocol schemas;
- events/checkpoints/results;
- TS/Python SDKs;
- CLI JSON envelopes and exit codes;
- plugin/adapter APIs;
- storage schema/migrations;
- pattern manifests; and
- Explorer APIs.

Compatibility tests install old/new combinations deliberately allowed by the
matrix. Breaking changes require migrations, changelog, deprecation window or
explicit prerelease boundary, and rollback instructions.

### 24.7 Upgrade, downgrade, rollback, and yank

Test:

- clean install;
- supported in-place upgrade;
- persisted event/checkpoint/database migration;
- old history replay under new binaries;
- supported mixed clients/workers;
- downgrade refusal or safe behavior;
- package/application rollback;
- failed migration recovery;
- release yank/deprecation; and
- emergency credential/key/advisory response.

No migration rewrites authoritative historical event bytes without a new
explicit migrated artifact and lineage.

### 24.8 RC and stable channel protection

Stable npm/PyPI tags and stable GitHub Release creation are impossible unless
the final roll-up is Green. When any mandatory row is Open/Partial/Blocked, the
only permitted outcomes are:

- no release;
- accurately labeled source alpha/beta; or
- a complete, supportable RC whose version, package tags, site, docs, release
  notes, and known limits all say RC.

An RC is not “basically stable.” Fallback channel tests prevent stable version
strings or tags from leaking into packages, site, docs, demos, and launch copy.

## 25. External usability, support, community, and growth workstream

### 25.1 External usability study

Prepare a consent-safe protocol with:

- recruitment criteria and conflict disclosure;
- at least five authentic non-maintainer participants;
- more than one operating system;
- both TypeScript and Python entry paths;
- clean environment definition;
- canonical at-most-three-command Quickstart;
- start/end timing and success criteria;
- no provider account, credential, network dependency, or telemetry opt-in for
  deterministic first success;
- failed-attempt retention and issue classification;
- privacy-safe notes/artifacts;
- remediation and retest disposition; and
- independent authenticity and 80% calculation review.

At least 80% must finish in 300 seconds. Failed participants are not removed
from the denominator. Agents cannot fabricate participants, elapsed time,
feedback, consent, or success.

### 25.2 Support readiness

Before stable or complete RC, provide:

- named support/incident roles and availability expectations;
- issue/discussion/security-report intake and triage rubric;
- severity, response, escalation, communication, and closure policy;
- known-limit and status communication;
- runbook for package yank, rollback, compromised dependency, leaked secret,
  data exposure, corrupt history, worker/store outage, and provider incident;
- privacy-safe support bundle and preview;
- backup/restore and migration recovery;
- release/channel ownership;
- tabletop exercise reports; and
- transparent maintainer-capacity limits.

Support claims cannot rely on an autonomous agent being continuously available.

### 25.3 Contributor experience

Create:

- architecture and “first contribution” guides;
- deterministic bootstrap and test commands;
- issue templates with evidence/security/privacy prompts;
- good-first-issue and help-wanted paths based on real bounded work;
- CODEOWNERS/ownership and review expectations;
- change-specific test/documentation checklists;
- protocol/API change proposal process;
- adapter/plugin/pattern contribution kits;
- community code of conduct and moderation process;
- release/contributor attribution policy; and
- maintainer response dashboards using privacy-safe data.

Contributors must not need hidden credentials or proprietary services for
normal development and CI.

### 25.4 Organic product-led growth

Growth follows successful use:

```text
accurate idea
  -> clean five-minute success
  -> useful trace/score
  -> repeatable pattern
  -> retained repository
  -> authentic story/contribution
  -> community discovery
```

Prioritize leading measures:

- unique successful deterministic runs;
- time to first success and failure reasons;
- seven-day retained repositories;
- repeated graph runs;
- installed CLI/package usage where privacy-safe and opt-in;
- external adapters/patterns/contributions;
- non-maintainer merged PRs;
- authentic public adopters/case studies;
- issue response and resolution; and
- documentation-to-success conversion.

### 25.5 Launch assets

Produce candidate-accurate:

- original brand/logo/banner assets;
- 60-second Quickstart;
- 90-second uncut terminal demo;
- interactive linear-versus-graph visualization;
- architecture essay;
- fourteen-step executable course;
- TS/Python side-by-side examples;
- recovery, performance, security, and cost reports;
- four case studies including failure;
- Graph Ready score/badge;
- trace and adopter galleries with consent;
- English and Chinese summaries; and
- channel-specific material for GitHub, Hacker News, X, LinkedIn, Reddit,
  Dev.to, and Chinese developer communities.

Every asset names the exact version and limitations. Scheduled content pauses
when first-run success, retention, security, or support is unhealthy.

### 25.6 5,000/6,000-star and “best on GitHub” boundary

Being the best Graph Engineering repository is a product aspiration measured
by technical completeness, trust, user success, retention, contribution,
support, and authentic ecosystem impact. A near-term 5,000-star milestone and
the original 6,000+ Day-21 stretch OKR are organic observations, not promises
an implementation can force.

Forbidden tactics include paid/farmed/bot stars, mutual-star schemes, fake
accounts, fabricated adopters/reports, undisclosed coordinated manipulation,
misleading benchmarks, false “production proven” language, or weakening
quality gates for launch timing. The repository may become excellent without
reaching a specific count on a specific day; it may reach a count without being
excellent. Only the first is under engineering control.

### 25.7 Growth experiments

Run bounded, dated, hypothesis-driven experiments such as:

- README concept/title/diagram clarity;
- Quickstart friction reduction;
- pattern-specific landing pages;
- demo length/format;
- side-by-side language positioning;
- issue/contribution onboarding;
- creator/maintainer trial invitations;
- architecture/security/recovery technical articles;
- release notes and changelog readability; and
- community office hours or pattern reviews.

Each records hypothesis, audience, asset version, start/end, success metric,
guardrails, result, decision, and privacy/consent. Stars may be observed, but
successful runs and retained users outrank impressions.

## 26. Dependency-ordered maximum-speed execution program

This program extends the calendar with completion waves. Waves overlap only
when file ownership and semantic dependencies allow it. A wave number is not a
promise that wall-clock work finishes in one day; it is a dependency and
integration boundary.

### 26.1 Continuous integration lane duties

The main/integration lane performs continuously:

1. keep the task registry, dependency graph, coverage matrix, release map, and
   master-plan addendum synchronized;
2. assign explicit file leases before parallel work;
3. freeze contract and fixture digests before native implementation;
4. record real heartbeats only from concrete files/tests/reports;
5. run the 30-minute scanner and deliver evidence-backed nudges;
6. inspect every agent diff for scope and overlapping paths;
7. execute shared conformance and whole-workspace gates after lane joins;
8. obtain independent hostile review proportional to risk;
9. create narrow immutable commits with exact identity and no unrequested
   co-author trailer;
10. revalidate meaningful commits from detached clean worktrees or installed
    artifacts;
11. push only after local acceptance and verify the remote ref; and
12. preserve every open exclusion and release leaf until candidate evidence
    genuinely closes it.

### 26.2 Wave A — cycle contract to native dynamic execution

**Prerequisites:** accepted D7 contract, frozen D7 schemas/fixtures, no open
spec P0/P1.

**Integration lane:**

- bind exact contract and review hashes;
- isolate D7 paths from D9/D4 work;
- validate schemas, semantic fold, duplicate keys, docs, and GraphPatch hashes;
- commit the spec contract;
- update task 024 evidence only after immutable revalidation;
- own the shared conformance runner and final D7 report.

**TypeScript lane:**

- implement native controller, event fold, store/checkpoint, GraphPatch applier,
  start/resume/replay/fork, leases/reservations, and hostile tests under
  `packages/runtime/**`;
- preserve existing DAG/pipeline/durable behavior;
- consume shared fixtures without editing them; and
- produce focused build/type/lint/test evidence.

**Python lane:**

- independently implement equivalent native behavior under `python/**`;
- preserve exact portable capture/cancellation semantics;
- consume shared fixtures without calling Node; and
- produce pytest/Ruff/mypy/artifact evidence.

**Review/conformance lane:**

- compare native outputs/events/checkpoints/hashes for every shared case;
- attack seen, bounds, reservation, patch, crash, lease, replay, fork, and
  checkpoint substitution;
- require zero provider calls on replay and zero committed-work reruns on
  resume; and
- issue no-open-P0/P1 decision before D7 Green.

**Exit:** 024/025/026/027 have immutable scoped evidence; T08/T15/T17/T18/T21
cycle-related portions pass; full release leaves remain Open until candidate
roll-up.

### 26.3 Wave B — truthful durable redaction

**Prerequisites:** accepted D9 contract with closed source/sink inventory,
schemas, attack corpus, and independent R3 no-open-P0/P1 decision.

**Integration lane:**

- join D9 schemas/corpus into offline validation;
- bind live sink/source registry checks;
- keep legacy v1alpha1 false-flag history explicitly unsafe;
- own shared seeded-canary and byte-scan harness; and
- block extended durability/security/Explorer until 089 passes.

**TypeScript lane:**

- implement portable capture, rule/pointer engine, disposition, receipts,
  protection envelope, sink guard, and transactional sink integration;
- replace false `redacted: true` behavior without rewriting history;
- cover events, checkpoints, artifacts, errors/logs/traces/CLI/support sinks as
  they exist; and
- add failure atomicity, retry, migration, bypass, and secret-scan tests.

**Python lane:**

- independently implement the same contract without virtual dispatch or TS
  delegation;
- integrate native stores/events/checkpoints and public error/CLI paths; and
- run pytest/Ruff/mypy plus hostile and artifact scans.

**Security review lane:**

- seed one or more unique canaries per source/sink;
- verify positive protection and intentional negative detector fixtures;
- scan all persisted/exported/support/package bytes;
- attack pointer, derivative, registry, authority, key/AAD, crash/retry, replay,
  and migration paths; and
- sign no-open-P0/P1 disposition.

**Exit:** 039/087/088/089 pass; I06/T26 and related release rows still require
candidate installation/privacy/security roll-up before Green.

### 26.4 Wave C — subgraphs, reducers, artifacts, streams, trace

**Prerequisites:** D4 dedicated contract accepted; cycle and redaction carriers
compatible; existing schedulers explicitly recognized as nonconformant for new
edge modes until implementation.

**Integration lane:** freeze plan/event/checkpoint/artifact/stream/trace schemas,
shared fixtures, namespace rules, reducer laws, and native-report comparison.

**TypeScript lane:** implement compiler lowering and runtime execution for
subgraphs, reducers, artifact references, true stream edges, and trace output.

**Python lane:** implement independent parity with equivalent async streams,
reducers, artifacts, nested scheduler scopes, and traces.

**Platform/review lane:** build trace fixtures/view scaffolding and attack
namespace collision, recursion, concurrent writes, corrupt artifacts, stream
overflow, cancellation, recovery, and false value-edge lowering.

**Exit:** D4 task's exact expected tests and X05/X08/X10 source milestone pass;
production storage and Explorer remain later work.

### 26.5 Wave D — integrated routers, barriers, and terminal algebra

**Prerequisites:** current native scheduler/pipeline/router/barrier bases and
accepted trace/event contracts.

Deliver conditional edge scheduling, durable route decisions, deadline/quorum
barriers, complete missing/failure statistics, confidence/human escalation,
every terminal state, and every failure policy. Run TS/Python lanes in parallel
and compare event order, decisions, results, exit codes, cancellation, replay,
and deadline behavior.

**Exit:** `D6-ROUTER-BARRIER-023` passes all six expected tests; X03/X04/X05/X06
source evidence is complete without claiming candidate Green.

### 26.6 Wave E — approval and extended durability

**Prerequisites:** D9 089, approval contract, D6 integrated routing/barriers.

Freeze and implement:

- approval identity/revoke/expiry/stale rules;
- leases/fencing/LockManager;
- checkpoint acceleration;
- SQLite event/checkpoint/metadata store;
- local ArtifactStore;
- replay/fork;
- non-idempotent external-effect confirmation;
- durable route and approval replay;
- dual-resume races; and
- storage/worker-ready interfaces.

TS and Python native lanes run independently; integration owns race/history
fixtures; a hostile reviewer attacks every crash and commit/release window.

**Exit:** D9 031/032/033/034 and approval task pass with no successful internal
node rerun, no stale approval, one dual-resume winner, and exact lineage.

### 26.7 Wave F — portable budgets and model routing

**Prerequisites:** D7 cycle join and D9 extended durable ledger primitives.

Contract lane freezes integer units, reservations, pricing snapshots, terminal
precedence, and model routing. Native lanes implement ledgers and routing.
Integration tests all dimensions at boundary and over-bound, contention,
crash/resume, fork, provider usage mismatch, currency/pricing changes, and hard
stop before dispatch.

**Exit:** D10 035/036/037/038 pass; no resource dimension can escape via retry,
cycle, subgraph, patch, fallback, fork, or concurrent worker.

### 26.8 Wave G — verification, judges, citations, and reflection

**Prerequisites:** integrated router/barrier, approval, and budgets.

Contract lane freezes rubric/vote/evidence/citation/judge/human-gate carriers.
Native lanes implement panels and reflection. Integration exercises maker/
verifier isolation, pass/reject/abstain/unknown, missing quorum, stale rubric,
citation contradiction, reproduction, judge tie/conflict, revision/cost limits,
crash/resume, and replay.

**Exit:** D11 040/041/042/043 pass and rejected/unknown findings cannot flow
through a gate as accepted.

### 26.9 Wave H — deny-by-default isolation and policy

**Prerequisites:** accepted redaction/approval/capability carriers, cycle and
verification behavior.

Contract lane freezes capabilities, worktrees, process/container providers,
merge gate, and threat model. Native lanes implement policy intersections and
providers. Red-team lane attacks filesystem/process/network/secret/MCP/prompt/
lease/merge escape across supported platforms.

**Exit:** D12 044/045/046/047 pass; planners/children/patches can never expand
authority; parallel writers remain isolated; structured conflicts preserve
user work.

### 26.10 Wave I — official adapters and complete DX

**Prerequisites:** isolation red-team Green, budgets, redaction, verification,
and approval.

Freeze vendor-neutral adapter contract. Implement deterministic mock first,
then selected model/HTTP/shell/MCP adapters in both runtimes. Add streaming,
tools, usage, retry/rate/circuit/fallback/cancel/redaction conformance. Complete
doctor, score, badge, picker, full CLI and first-run remediation.

**Exit:** D13 spec/native/join/DX tasks pass from packed artifacts; optional
live-provider evidence is labeled external and cannot replace mock conformance.

### 26.11 Wave J — API freeze, plugins, MCP runtime, and pattern skeletons

**Prerequisites:** adapters and D4 runtime contract, isolation and verification.

Inventory every public export, schema, diagnostic, CLI envelope, storage,
adapter, plugin, and MCP API. Resolve incompatible drafts before freeze. Ship
plugin SDK/discovery with policy/isolation, approval-gated runtime MCP, all ten
honest pattern skeletons, and canonical unscoped npm distribution rehearsal.

**Exit:** D14 API/MCP/pattern/npm tasks pass compatibility and packed-install
gates. API freeze is a reviewed immutable revision, not a mutable document.

### 26.12 Wave K — production stores, workers, observability, and Explorer

**Prerequisites:** extended durability, adapters, API freeze, redaction,
verification, and D4 trace/artifact contract.

Parallel lanes implement SQLite/local defaults, PostgreSQL/S3/LockManager,
distributed workers, OTel/exporters, Explorer backend, and React frontend.
Quality lane executes storage conformance, worker chaos, redaction canaries,
large-graph UI, accessibility, security, first-run, and performance baselines.

**Exit:** D15 storage/Explorer/performance tasks pass with bounded resource and
no cross-tenant/secret exposure.

### 26.13 Wave L — ten complete patterns and education assets

**Prerequisites:** frozen public APIs and the capabilities each pattern uses.

Build pattern bundles in independent groups only when their dependencies are
Green. The integration lane owns the common manifest/checker. Documentation
lane builds the executable course, cases, bilingual Quickstarts, uncut demo,
architecture essay, side-by-side examples, and known-limit synchronization.

**Exit:** all ten pattern tasks, CTRL-PATTERNS-071, D18 education assets, and
CTRL-DOCS-073 pass machine checks and independent content/security review.

### 26.14 Wave M — security, privacy, performance, Beta, and usability

**Prerequisites:** feature-complete candidate-shaped tree and all critical
security joins.

Run full threat model, fuzz/property/chaos, secret/license/SBOM/dependency/static
scans, isolation escapes, privacy/default-off checks, performance/coverage,
OS/runtime matrix, package installs, and support tabletop. Build an immutable
Beta, recruit authentic testers, retain failures, remediate and retest.

**Exit:** D16, D17, D18 compatibility/privacy/usability/support/acceptance tasks
pass; no open P0/P1 or unaccepted high/critical issue; external evidence is
authentic and independently reviewed.

### 26.15 Wave N — RC, provenance, final roll-up, and release

**Prerequisites:** all prior implementation/quality/pattern/docs/external gates.

1. Freeze one source candidate and all contract/API references.
2. Build deterministic npm/Python/site/container artifacts.
3. Run clean install, upgrade, migration, rollback, OS/runtime, package, and
   complete CLI matrices.
4. Generate checksums, SBOMs, attestations, claims audit, known limits, release
   asset manifest, and support roster.
5. Populate the append-only candidate overlay with exact evidence for every
   required ancestor.
6. Independently verify all 178 release leaves and produce blockers for every
   non-Green mandatory row.
7. Run trusted publishing rehearsal without accidental release.
8. Sign the stable-versus-complete-RC-versus-no-release decision.
9. Publish only the authorized channel.
10. Download public artifacts, verify digests/provenance, run final smoke, and
    monitor/support transparently.

**Exit:** stable v1 only when every mandatory row is Green. Otherwise publish
only an accurately complete RC if its own supportability gates pass, or do not
release.

### 26.16 Integration cadence within every wave

For each bounded milestone:

```text
read canonical plan and applicable contracts
  -> assign disjoint path ownership
  -> implement focused behavior and tests
  -> author self-check
  -> independent hostile review
  -> remediate findings
  -> focused native gates
  -> shared conformance
  -> full workspace/package/security/docs gates
  -> narrow commit with exact identity
  -> detached/installed immutable revalidation
  -> append task evidence/status
  -> push and verify remote SHA
  -> retain exclusions and start next ready wave
```

## 27. Release-leaf family no-omission ledger

The canonical checklist remains the row-level authority. This section gives
the human audit join for every family.

### 27.1 Stable-v1 decision joins — 8 leaves

Require durable recovery, security, cross-language conformance, package
provenance, external usability, all mandatory tests/quality/platform/packages/
patterns/assets, all planned Day-21 assets with supportable Beta/RC, and final
stable-versus-RC decision. Any failed join is stable no-go.

### 27.2 Non-negotiable invariants — 10 leaves

Require canonical shared spec, structured failures, deterministic plumbing,
bounded cycles/retries/fan-out, at-least-once effect honesty, default-off
telemetry/capture with protection, patch compiler/policy/permission/budget
gates, no authority expansion, no implicit quorum pass, and no unsupported
production/experience claims.

### 27.3 Cross-language equality — 10 leaves

Require exact canonical identities; compilation verdicts/diagnostics; route
decisions; barriers; event ordering; terminal/failure envelopes; retry/timeout/
cancel accounting; resume/replay/fork lineage; CLI JSON/exits; and adapter/
event/checkpoint/artifact/lock/storage conformance.

### 27.4 Mandatory scenarios — 33 leaves

Require all invalid graph/schema/router/loop/authority cases; 100-way bounded
parallelism; every failure policy; stream backpressure; barrier deadline;
route replay; malicious patches; verifier outcomes; seen convergence; every
hard limit; crash windows; dual resume; replay/fork; stale approval; worktree
conflicts; namespace isolation; provider behavior; secret redaction;
cancellation; prompt injection; full CLI; storage; ten pattern E2E; 1,000-node
resource bounds; and kill/network/store/artifact chaos.

### 27.5 Quantitative thresholds — 11 leaves

Require coverage, unit/integration volume, shared adapter/storage conformance,
100 randomized faults, full OS/runtime matrix, mock/live-provider policy,
performance regression gate, security scans/no blockers, trusted publication,
five-minute external usability, and zero P0/P1 with five external reports.

### 27.6 Platform matrix — 17 leaves

Require every declared Node/Python/OS/architecture/package/CLI combination,
including clean installation and platform-specific filesystem/process behavior.
Skips and exclusions are explicit row outcomes.

### 27.7 Package/distribution — 13 leaves

Require source-to-package identity, public exports, binaries, schemas/assets,
dependency rewriting, no leaks, clean imports/execution, canonical unscoped npm
package, Python wheel/sdist, docs/help/version, upgrade, and registry verification.

### 27.8 Supply chain/security — 14 leaves

Require trusted workflows, pinned actions/materials, dependency review, CodeQL/
SAST, secrets, licenses, SBOMs, checksums, attestations, package/image scans,
provenance verification, redaction, isolation, prompt injection, and signed
security disposition.

### 27.9 External usability — 10 leaves

Require authentic participant count, 80% timing, retained failures, zero P0/P1,
three-command Quickstart, no credential/network/telemetry requirement, OS and
language diversity, understandable remediation, consent/privacy, and independent
authenticity calculation.

### 27.10 Patterns — 11 leaves

Require the common Pattern Bundle roll-up plus each of the ten patterns. Every
bundle needs both languages, all source formats, deterministic E2E, failure and
recovery, diagrams, budgets, permissions, operations, and launcher guides.

### 27.11 Documentation/assets — 16 leaves

Require Quickstarts, concepts, complete architecture/security/operations,
CLI/SDK/MCP/plugin/storage references, ten patterns, executable course,
side-by-side examples, case studies, uncut demo, bilingual launch essentials,
claim audit, links/snippets, and candidate version/limitation consistency.

### 27.12 Growth/community — 7 leaves

Require honest assets/experiments/metrics/community/contributor execution. The
three star/adoption/PR outcome observations remain non-blocking but authentic;
they are never fabricated or reclassified as technical gates.

### 27.13 Support — 8 leaves

Require support roster, incident triage, security/privacy escalation, rollback/
yank, migration/backup recovery, support bundles, tabletop evidence, and
transparent capacity/known-limit communication.

### 27.14 RC fallback/no-go — 10 leaves

Require complete blocker manifest, asset/support readiness, candidate identity
across every surface, RC channel labeling, stable-tag protection, independent
decision, and no release when even the fallback is not supportable.

### 27.15 Family roll-up rule

The family summary is Green only when every constituent canonical row is Green.
Counts, averages, percentages, scanner health, or a family document cannot
override one Open/Partial/Blocked mandatory row.

## 28. Continuous monitoring, logging, and recovery of development work

### 28.1 Thirty-minute scanner operation

Keep the user-level timer active. Every scan validates registry structure,
dependencies, heartbeats, artifacts, test evidence, completion references, and
timestamps; writes an atomic snapshot; and creates a cooldown-bounded nudge.
The supervising agent reads the result, contacts slow active lanes, and starts
the next ready task when a slot frees.

Scanner liveness is not semantic correctness. Artifact mtimes after checkout,
generated files, or fake heartbeat updates do not prove progress. Heartbeats
are updated only after a concrete report, file, test, or decision.

### 28.2 Development logs

Retain:

- daily append-only integration summaries;
- per-agent local JSONL events where configured;
- scan snapshots and nudge queue;
- ADRs for durable technical decisions;
- incidents for failed/destructive/security-sensitive events;
- independent reviews;
- release evidence and candidate overlay; and
- exact commit/push/remote verification.

Do not log raw prompts, provider responses, credentials, authorization headers,
secrets, or user data by default. Logs intended for Git are sanitized and
reviewed.

### 28.3 Slow or blocked work

When a task is slow:

1. request concrete completed files/tests, remaining P0/P1, and estimated exit;
2. distinguish real complexity from an idle/stuck lane;
3. reduce scope only by splitting into explicit dependent tasks, never by
   dropping acceptance;
4. preserve partial work and assign a new lane when needed;
5. prevent concurrent edits to the same shared file;
6. record a blocker only when the exact same impasse persists and no safe work
   remains; and
7. move free slots to the next ready dependency.

### 28.4 Commit discipline

Meaningful milestones are committed and pushed with:

- exact reviewed path allowlist;
- unrelated dirty work excluded;
- `git diff --check` and applicable gates;
- correct `reacher-z <mtrxcop@gmail.com>` author/committer when requested;
- no co-author trailer unless explicitly requested;
- concise truthful subject and empty/unambiguous body policy;
- immutable tree/parent/path manifest inspection;
- clean detached validation proportional to risk; and
- `git ls-remote` confirmation after push.

Do not amend or rewrite independently bound evidence commits. Corrections use a
new commit and append-only superseding evidence.

### 28.5 Recovery from shared-worktree integration races

If a checker observes a partially updated shared control file:

1. preserve the failed run as evidence;
2. stop concurrent root-owned writers;
3. inspect exact diffs and intended task states;
4. repair with a narrow patch;
5. rerun JSON/schema/control tests;
6. create an isolated commit;
7. revalidate committed bytes; and
8. record the transient failure and final result.

The earlier temporary `39/40` release-map run is the expected fail-closed model,
not a reason to make the checker permissive.

## 29. Final no-omission completion protocol

Before anyone says “the entire plan is complete,” perform a new independent
audit from scratch:

1. read the original 368-line plan and this complete append-only expansion;
2. enumerate every day, capability, package, command, pattern, course module,
   platform, test threshold, security control, external gate, asset, support
   requirement, and growth boundary;
3. compare that inventory to the task registry and reject missing, duplicate,
   retired, cyclic, or partial-producer mappings;
4. verify every task contract and exact expected artifact/test coverage;
5. select one clean immutable candidate and populate append-only evidence for
   all required release ancestors;
6. install/download actual candidate artifacts on the complete supported
   matrix;
7. execute native TS, native Python, cross-language, storage, adapter,
   isolation, security, chaos, performance, package, docs, pattern, course,
   upgrade, and external usability gates;
8. verify every one of the 178 canonical checklist rows independently;
9. retain every failure, exclusion, skip, and open issue in the blocker report;
10. prove all public surfaces identify the same candidate and known limits;
11. obtain independent technical, security, release, provenance, usability, and
    support sign-offs;
12. run the fail-closed stable-versus-complete-RC-versus-no-release roll-up;
13. publish only the authorized channel;
14. verify public artifact/source/provenance identity; and
15. append the final audit without deleting this history.

If the audit finds one missing requirement, the plan is not complete. Add a
task, preserve the gap, execute it, and repeat. Popularity, urgency, effort
already spent, or a calendar deadline never changes this rule.

## 30. Ultimate product standard

Graph Engineering should earn recognition by making graph-shaped agent systems
understandable, executable, durable, secure, portable, inspectable, and easy to
adopt. The repository succeeds when a new user can go from a truthful concept
to a working bounded graph in minutes, understand every edge and failure,
resume after a crash, inspect evidence, control authority and cost, contribute
a pattern or adapter, and trust that TypeScript and Python mean the same thing.

The engineering standard is therefore:

- broader than an orchestration demo;
- deeper than a set of prompts or static workflow templates;
- safer than ambient shell/model authority;
- more honest than a false exactly-once, redacted, production-proven, or star
  claim;
- more portable than one language calling the other;
- more observable than a final text answer;
- more durable than an in-memory conversation;
- more testable than emergent self-routing;
- more welcoming than a maintainer-only codebase; and
- continuously measured against authentic user success, not vanity alone.

The aspiration to become the leading open-source Graph Engineering repository
is pursued through this complete standard. The project will keep appending
explicit work whenever real implementation, review, external use, or failure
reveals a missing requirement. It will not declare victory by making the plan
smaller.

## 31. D7 native-cycle hardening, productionization, and adoption expansion

This section was appended on 2026-07-27. It does not replace, weaken, reorder,
or mark complete any earlier requirement. It records additional work discovered
while implementing the first exact TypeScript/Python native-cycle join. Every
item below remains subject to the immutable-evidence, independent-review,
fail-closed release, and no-omission rules above.

### 31.1 Immutable implementation baseline and current truth

The first D7 implementation baseline consists of two immutable commits on
`feat/authoring-foundation`:

- `abd400b0ffa61b9eb648d69a173939ecf387d004` implements the TypeScript native
  bounded-cycle controller, event fold, local store, GraphPatch runtime, and
  focused tests;
- `a6c8e67c56d9ebcd8596307d9166763f48ac8713` implements the independent Python
  controller surface, strict Python GraphPatch replay validation, and an
  executable TypeScript/Python join;
- the second commit has tree
  `1c61314bb4abc89222606c4bca15d20275e30e15`, parent
  `abd400b0ffa61b9eb648d69a173939ecf387d004`, and exact author/committer
  `reacher-z <mtrxcop@gmail.com>`;
- the exact join currently compares 93 canonical events, 17 canonical activity
  input preimages, all three controller modes, five terminal results, one
  accepted GraphPatch/revision, one commit-then-throw/takeover recovery, and
  five checkpoints;
- the clean committed candidate currently passes 1,065 Python tests plus two
  subtests, Python Ruff and strict Mypy, the workspace lint/typecheck gates,
  the full cross-language conformance runner, local Markdown link validation,
  and wheel/sdist build-and-install smoke tests; and
- these facts describe a meaningful alpha implementation, not production
  readiness, independent acceptance, scheduler integration, distributed
  safety, or completion of the master plan.

The baseline establishes these implemented invariants:

1. a request binds activity identity, implementation hash, side-effect class,
   timeout, maximum attempts, and per-attempt maximum cost;
2. a round must reserve the complete request-bound worst-case envelope before
   dispatch, rather than shrinking the reservation to remaining budget;
3. finder, candidate evaluator, condition or optimizer, and enabled patch
   planner work have explicit deterministic input preimages;
4. seen-state deduplication applies to every discovered key, including rejected
   findings, so rejected candidates cannot keep a loop artificially wet;
5. every durable append is validated by folding the prospective full prefix;
6. replay is event-derived and must not call clocks, models, handlers, policy
   services, random sources, or compilers except where accepted GraphPatch
   recovery explicitly recompiles the stored graph revision;
7. a commit-then-throw recovery reuses committed work and does not rerun the
   finder in the covered scenario;
8. an open non-idempotent activity is fail-closed and blocks resume or fork
   before a new lease or new external dispatch;
9. GraphPatch fragment validation is shared by live application, restoration,
   and pure event-fold replay; and
10. TypeScript and Python equality is checked on canonical carriers rather than
    on a hand-selected semantic summary.

### 31.2 Explicit non-claims and blockers that must remain visible

Until the work below is complete and independently accepted, public materials
must state all of the following:

- `MemoryCycleStore` and `MemoryCycleControllerEventStore` are deterministic
  local/test adapters, not durable production stores;
- the numeric lease and fencing fields are validated and folded, but no current
  local adapter provides a distributed lock or database-enforced fencing;
- the native controller is separate from the ordinary DAG scheduler and does
  not yet mutate an in-flight scheduler graph;
- scheduler checkpoint acceleration is absent; the authoritative path folds the
  complete stream;
- cancellation, corruption, budget, fork, patch rejection, and recovery have
  substantial tests but not yet the exhaustive cross-language boundary lattice
  specified below;
- independent hostile review is still required even when all author-run checks
  pass;
- telemetry v1alpha1 payload protection and the D9 redaction contract remain
  separate open work and may not be inferred from D7 correctness;
- exactly-once external effects are not claimed; non-idempotent interruption is
  intentionally in-doubt and requires an explicit future resolution protocol;
- current event and checkpoint formats are alpha contracts and need versioned
  migration policy before stable release; and
- a 5,000- or 6,000-star goal is an adoption aspiration, never a deliverable
  that engineering can guarantee or manufacture.

### 31.3 Parallel execution topology and ownership discipline

The remaining work should run at the highest safe parallelism without allowing
multiple writers to collide on the same contract or evidence surface. Use the
following lanes whenever agent capacity is available:

1. **D7 semantics lane:** owns cycle schemas, normative semantics, event fold,
   checkpoint projection, replay, fork, and cross-language fixtures;
2. **D7 storage lane:** owns production event/checkpoint stores, transactional
   compare-and-swap, leasing, fencing, migrations, and storage chaos tests;
3. **D7 integration lane:** owns ordinary-scheduler GraphPatch integration,
   revision routing, scheduler pause/resume interaction, and end-to-end demos;
4. **D7 security lane:** owns malicious history, hostile patch fragments,
   authority binding, capabilities, size/depth controls, and threat-model
   evidence;
5. **D7 quality lane:** owns property tests, differential fuzzing, model-based
   state machines, performance benchmarks, package smoke tests, and matrix CI;
6. **D7 education lane:** owns concepts, failure modes, API reference, examples,
   migration material, and course exercises; and
7. **D7 independent-review lane:** must not author the candidate it accepts and
   owns the final adversarial review report and disposition ledger.

No lane may silently edit another lane's active files. Before dispatching work,
the root owner must record exact files, inputs, outputs, dependencies, forbidden
changes, test commands, and acceptance criteria in the task registry. Shared
control files remain root-owned. If a sub-agent becomes unavailable, the root
agent may continue implementation but must retain the missing independent-review
gate rather than self-approving it.

Every 30-minute progress scan must report:

- task ID, owner, current phase, last heartbeat, and exact changed paths;
- last passing and failing commands with timestamps and candidate hashes;
- estimated remaining work based on concrete unchecked acceptance rows;
- blocking dependency and the person or task capable of clearing it;
- scope drift, shared-file collision, unbounded retry, or suspicious inactivity;
- whether the task can be split into another independent bounded unit; and
- the next action the root agent will take if no heartbeat arrives.

The scanner may notify and escalate, but it must never auto-commit unknown
changes, invent progress, restart an unbounded task, or mark work complete from
elapsed time alone.

### 31.4 P0 semantic decision: in-doubt activity cardinality and coalescing

The current TypeScript fold can append a failed activity marked `inDoubt` to an
in-doubt projection while the checkpoint schema caps the collection at one.
Python and TypeScript must not drift on whether a closed failed activity remains
in the same projection as an open interrupted non-idempotent claim. Resolve this
before expanding production stores.

Required design work:

1. enumerate the distinct states: open claim with no settlement, settled
   failure with `inDoubt=true`, operator-resolved effect, retriable idempotent
   failure, and terminal controller with unresolved effect;
2. decide whether the protocol permits zero, one, or many simultaneous in-doubt
   effects and explain why;
3. if cardinality remains one, define deterministic replacement/coalescing and
   prohibit a second non-idempotent dispatch while one unresolved claim exists;
4. if cardinality becomes many, revise schemas, projection order, checkpoint
   bounds, query API, resolution API, storage indices, and UI expectations;
5. define whether a settled-but-unknown effect is retained until explicit
   operator resolution or transformed into a terminal result immediately;
6. define replay/fork inheritance exactly, including whether a child may inherit
   an unresolved effect without inheriting attempt/cost charges it did not make;
7. specify stable ordering and stable activity identity when multiple records
   exist;
8. add expected-event fixtures before modifying either implementation;
9. implement the chosen semantics in TypeScript and Python independently;
10. compare canonical checkpoints and error objects cross-language; and
11. obtain independent review focused on accidental duplicate external effects.

Acceptance tests must cover:

- one open non-idempotent claim followed by resume;
- one open claim followed by fork;
- a settled in-doubt failure followed by resume and fork;
- attempts to start a second non-idempotent activity while one is unresolved;
- idempotent and side-effect-free failures adjacent to an unresolved effect;
- checkpoint create/restore at every state;
- terminal replay with unresolved effect;
- an operator resolution with the wrong activity key, stale fence, or stale
  history prefix;
- duplicate resolution commands; and
- exact TypeScript/Python error code, path, details, event bytes, and state.

No automatic reinvocation, automatic success, or silent projection drop is
acceptable.

### 31.5 Complete durable-boundary fault-injection lattice

Build a table-driven harness that injects a process loss, store error, timeout,
cancellation, and commit-then-throw at every durable boundary. The harness must
derive boundaries from the event vocabulary so newly added events cannot evade
coverage.

For each event type, test all meaningful points:

1. before event construction;
2. after event construction but before prospective fold;
3. after prospective fold but before compare-and-swap;
4. before store transaction commit;
5. after transaction commit but before the store returns;
6. after store return but before in-memory state update;
7. after in-memory state update but before the next dispatch;
8. before checkpoint construction;
9. after checkpoint construction but before checkpoint save;
10. after checkpoint save but before caller acknowledgment; and
11. during terminal result delivery.

The matrix must include at least these event families:

- controller creation, lease acquisition, voluntary lease release, and
  takeover;
- round reservation and unused reservation release;
- activity start, success, failure, timeout, cancellation, and retry;
- discovery commit, evaluation commit, mode decision, and seen-state update;
- patch proposed, rejected, accepted, and resulting revision exposure;
- round commit, dry-count update, and terminal decision;
- fork creation, parent lineage binding, and child first lease; and
- explicit future in-doubt resolution.

For every injected failure, assert:

- the committed prefix is valid and hash-linked;
- no uncommitted event appears on replay;
- CAS conflicts do not overwrite a winner;
- a committed success is not dispatched again;
- reserved attempts/cost/dynamic nodes settle exactly once;
- a stale fence cannot append;
- replay has zero handler invocations;
- resume either progresses safely or emits the exact fail-closed error;
- terminal resume performs no writes; and
- TypeScript and Python produce the same canonical outcome for the same
  committed prefix.

### 31.6 Cancellation and timeout boundary matrix

Cancellation must be cooperative, durable where required, and incapable of
creating a false success. Add deterministic cancellation triggers:

- before the first round reservation;
- immediately after reservation but before finder claim;
- during every finder attempt;
- after finder success but before discovery commit;
- after discovery commit but before evaluator claim;
- during every candidate-evaluator attempt;
- after evaluator success but before evaluation commit;
- during condition and optimizer evaluation;
- immediately before patch-planner claim;
- during patch planning;
- after patch proposal but before GraphPatch decision;
- after accepted decision but before revision visibility;
- after round commit but before the next preflight; and
- during pause, resume, replay, and fork public operations.

For each trigger, test `none`, `idempotent`, and `non-idempotent` activity
classes where meaningful. Distinguish caller cancellation from per-attempt
timeout and controller max-duration exhaustion. Confirm that:

- a cancellation cannot release work that actually remains in-doubt;
- timeout charging uses the request-bound per-attempt ceiling and actual runtime
  charging rules exactly as specified;
- cancellation never increments the dry counter unless a valid dry round was
  committed;
- a late handler result cannot append after its attempt was durably cancelled;
- repeated cancellation is idempotent;
- cancellation errors preserve structured codes and stable paths; and
- cancellation tests use bounded clocks and bounded waits, never real sleeps
  that make CI flaky.

### 31.7 Budget boundary lattice and accounting proof

For every numeric limit, generate cases at `limit - one unit`, `limit`, and
`limit + one unit`, plus zero/minimum, maximum representable, fractional USD,
and invalid non-finite values where the contract allows numeric input.

Limits to cover independently and in combinations:

- maximum iterations;
- maximum duration in milliseconds;
- maximum total attempts;
- maximum total cost USD;
- maximum discoveries;
- maximum dynamic nodes;
- maximum candidates per round;
- maximum candidate bytes;
- maximum candidate batch bytes;
- per-activity attempts per round;
- per-attempt maximum cost; and
- GraphPatch structural depth, fan-out, and output limits.

Required accounting invariants:

1. a round starts only if its complete worst-case request-bound envelope fits;
2. no implementation adaptively reduces retry ceilings to make an otherwise
   invalid round fit;
3. a disabled runtime route releases its reserved envelope deterministically;
4. successful early attempts release unused retry capacity exactly once;
5. failed and timed-out attempts charge according to the normative rule;
6. dynamic-node capacity is reserved before patch planning and settled against
   the accepted patch, not merely the proposal;
7. rejected and dry-run patches expose complete budget evidence without making
   a revision visible;
8. rounding and canonical serialization of fractional cost are identical in
   both languages;
9. a crash between reservation and settlement recovers from events without
   double release or double charge; and
10. the terminal reason uses one shared precedence table when several limits
    become true at the same boundary.

Add a model-based ledger oracle that computes expected available, reserved,
charged, and released vectors independently of the runtime implementation.
Compare every event prefix against the oracle, not just the terminal result.

### 31.8 Hostile GraphPatch fragment and replay suite

Expand validation beyond the initial missing-config, missing-`from`, and empty
port regressions. Cover every fragment field and every trust boundary.

Malformed structure cases:

- non-object patch, base, append, node, edge, endpoint, output, or metadata;
- missing or extra properties at every closed-object level;
- duplicate node IDs, edge IDs, and output names;
- invalid identifiers, Unicode normalization ambiguities, pointer escaping, and
  maximum-length boundaries;
- missing node kind/config/schema/side-effects;
- malformed `from`/`to` endpoint node or port;
- unsupported edge mode and inconsistent stream/value modes;
- references to missing nodes, removed nodes, or outputs not yet visible;
- empty append, oversized append, excessive graph depth, fan-out, node count,
  edge count, output count, and canonical byte size;
- forbidden mutation or deletion disguised as append;
- non-portable JSON including NaN, infinity, negative zero ambiguity, cycles,
  aliases, custom objects, duplicate JSON keys, and out-of-range values; and
- patch ID/hash/base/revision mismatches.

Authority and execution cases:

- proposer activity key differs from the durable planner claim;
- stale or mismatched principal, proposer, run, tenant, deployment, effective,
  policy, or approval hash;
- missing required capability;
- capability allowed at one scope but denied at a narrower scope;
- patch attempts to modify a succeeded node or an edge feeding succeeded work;
- stale base after another patch wins;
- concurrent identical patch, concurrent distinct patch, and replayed patch ID;
- accepted decision commit-then-throw;
- rejected decision commit-then-throw;
- compiler diagnostics with deterministic order; and
- recorder callback failure before and after durable decision.

Run every malicious case through:

1. direct public shape validation;
2. live `apply` or `propose` execution;
3. store restoration;
4. event-fold replay with a correctly re-signed malicious history;
5. checkpoint validation; and
6. TypeScript/Python differential comparison.

Every rejected case must prove zero unintended recorder calls, zero visible
revision mutation, zero leaked dynamic-node capacity, and a stable error code,
JSON pointer, phase, and diagnostic order.

### 31.9 Replay, fork, and lineage proof expansion

Add a generated lineage tree rather than testing only one parent/child pair.
The bounded test tree must include start → fork A → fork B, sibling forks at the
same parent prefix, forks from different valid prefixes, and attempts to create
cycles in lineage metadata.

Required invariants:

- a child binds exact parent run ID, stream ID, sequence, record hash, history
  prefix hash, request hash, and controller identity where the contract requires;
- changing any parent byte invalidates the child lineage;
- a child inherits only explicitly listed event-derived state;
- the child does not invent parent attempts, costs, leases, or timestamps;
- a parent cannot be garbage-collected while a retained child references it;
- replay detects missing ancestors, duplicate ancestors, ancestry cycles, and
  a parent prefix longer or shorter than declared;
- sibling streams cannot mutate one another;
- fork from terminal history has defined behavior and zero accidental dispatch;
- fork from an open idempotent claim follows the normative retry rule;
- fork from an open non-idempotent claim fails before new lease acquisition;
- checkpoint restore and full-fold restore yield identical child state; and
- TypeScript and Python canonical child creation events and errors match.

Add a lineage manifest/export format so support tooling can package every
required ancestor with hashes for offline replay.

### 31.10 Production CycleStore contract

Promote storage semantics into an explicit provider contract before writing a
database adapter. The contract must define:

- atomic append of one or more events against an expected tail sequence;
- unique stream identity and immutable committed event bytes;
- database-enforced record-hash and previous-hash continuity where practical;
- maximum event batch size and maximum event size;
- strongly consistent tail reads required for ownership transfer;
- paginated prefix reads that cannot skip or duplicate events;
- checkpoint save/load/list/delete semantics without making checkpoints
  authoritative;
- lease acquire/renew/release/takeover with monotonically increasing fence;
- idempotency behavior for retried client requests;
- transaction isolation requirements;
- tenant partitioning and authorization hooks;
- retention, archival, legal hold, backup, restore, and compaction behavior;
- encryption-at-rest and protected-payload integration boundaries;
- observability without raw sensitive payload leakage;
- schema/version discovery and migration locking; and
- explicit error taxonomy for conflict, stale fence, unavailable store,
  corruption, quota, permission, and unsupported version.

Write a provider-neutral conformance suite that every adapter must pass. It must
be runnable against a deterministic reference model, SQLite, and PostgreSQL.
Tests must never pass merely because an adapter throws a generic exception.

### 31.11 SQLite reference durable adapter

Implement a single-process durable SQLite adapter as the first persistence
step, with clear non-distributed scope.

Deliverables:

- migrations with schema version table and reversible development migration
  instructions;
- events table keyed by tenant/stream/sequence with unique event and record
  hashes;
- stream-head table updated in the same transaction as append;
- checkpoints table keyed by scope/checkpoint ID and bound to tail hash;
- leases table with epoch/fence/holder/expiry and transactional compare/update;
- WAL configuration guidance, busy timeout, connection ownership, and bounded
  transaction retries;
- corruption and foreign-key checks;
- export/import and backup/restore commands;
- Python and TypeScript adapters that do not shell out to one another; and
- a crash harness that terminates a writer process at transaction boundaries.

Acceptance requires process restart recovery, concurrent-writer CAS conflict,
stale-fence rejection, checkpoint corruption fallback to full fold, backup
restore, migration from the immediately previous alpha schema, and exact native
conformance in both languages.

### 31.12 PostgreSQL production adapter and real fencing

Implement PostgreSQL only after the provider suite and SQLite semantics are
stable.

Required design:

- one transaction for expected-head verification, event append, head update,
  and lease-fence verification;
- row-level lock or equivalent compare-and-swap with documented isolation level;
- monotonically increasing fence generated by the database, never by an
  untrusted client clock;
- database time for lease expiry decisions, with documented skew behavior;
- bounded lease renewal and takeover rules;
- server-side constraints for sequence and hash chain;
- tenant-aware indexes and optional row-level security guidance;
- pagination that preserves a stable snapshot;
- connection pool limits, statement timeout, lock timeout, and retry taxonomy;
- migration locking and zero/low-downtime rollout guidance;
- logical backup/restore and point-in-time recovery drill; and
- metrics for conflict rate, lease loss, append latency, fold length,
  checkpoint hit/fallback, and corruption detection.

Chaos tests must include two owners racing for one stream, delayed old-owner
writes after takeover, network loss before and after commit, primary failover,
read replica lag, connection termination, deadlock retry, disk/full quota, and
schema migration while readers are active. A stale owner must never append even
if its process resumes after a long pause.

### 31.13 Checkpoint acceleration without checkpoint authority

Define and implement checkpoint-assisted restore while keeping the event stream
authoritative.

Algorithm requirements:

1. load a named or newest eligible checkpoint;
2. validate API version, controller/request hashes, stream/scope identity,
   sequence, tail record hash, history prefix hash, projection schema, and every
   bounded collection;
3. reject or warn on a future/unsupported version;
4. fold all subsequent events from the exact next sequence;
5. optionally compare a sampled accelerated fold with a full fold;
6. fall back to full history on any checkpoint read, decode, validation, or
   compatibility failure unless policy requires a hard stop;
7. emit a protected structured warning without changing the terminal result;
8. never call a handler merely because a checkpoint is absent or invalid; and
9. support deterministic checkpoint cadence based on events/bytes, not wall
   clock alone.

Benchmarks must measure restore latency and memory for 100, 1,000, 10,000, and
100,000-event streams, while correctness tests compare every accelerated result
to a full fold byte-for-byte.

### 31.14 Ordinary scheduler and GraphPatch integration

Integrate dynamic revisions without permitting implicit unbounded graph cycles.

Design constraints:

- the ordinary compiled graph remains acyclic per revision;
- the cycle controller owns repetition and proposes append-only revisions;
- a scheduler applies only a durable accepted revision with a matching base;
- already succeeded/running nodes and consumed edges cannot be redefined;
- ready-queue derivation is revision-aware and deterministic;
- a new node cannot observe outputs it is not authorized to read;
- newly added edges cannot retroactively change already committed input
  preimages;
- scheduler events bind graph revision, graph hash, and revision hash;
- pause/resume has a defined handoff point between scheduler and controller;
- a rejected/stale patch never changes scheduler-visible topology;
- concurrent accepted revisions have a single CAS winner; and
- the integration retains bounded attempts, concurrency, duration, cost,
  discovery, and dynamic-node limits.

End-to-end scenarios:

1. security sweep discovers routes and appends one verifier node per approved
   finding under a global dynamic-node cap;
2. research fan-out adds a synthesis node only after source collection;
3. code migration loops failing files back through bounded repair attempts while
   every static revision remains acyclic;
4. a stale planner loses a base race and replans from the new revision;
5. process loss after patch acceptance resumes without double-scheduling a new
   node; and
6. a malicious patch targeting completed work is rejected before scheduler
   mutation.

### 31.15 Observability, protected evidence, and support tooling

Add operator views that explain the graph without exposing raw private payloads.

Required derived views:

- controller summary with mode, iteration, dry count, current revision, limits,
  charged/reserved/released budgets, and terminal reason;
- activity timeline with stable keys, attempts, side-effect class, duration,
  outcome, and in-doubt state;
- graph revision chain with patch decisions, bases, hashes, authority snapshot
  references, diagnostics, and visible nodes/edges/outputs;
- replay/fork lineage tree;
- lease/fence ownership history;
- checkpoint health and fallback count;
- seen/accepted/rejected/unknown counts without revealing candidate values; and
- storage conflicts, corruption warnings, and recovery actions.

All logs and metrics must pass D9 redaction/sink-guard policy before claiming
protected observability. High-cardinality IDs belong in traces or protected
evidence, not unbounded metric labels. Provide a support bundle command that
exports manifest, schemas, hashes, sanitized projections, configuration, and
version information while excluding raw candidate, prompt, tool output, secret,
and protected blob content by default.

### 31.16 Property testing, differential fuzzing, and state-machine models

Build generators for valid and invalid requests, activity outputs, event
prefixes, checkpoints, GraphPatch documents, revisions, lease transitions, and
lineage trees.

Properties to enforce:

- validation is deterministic and does not mutate caller input;
- canonical serialization and hashes are stable across languages;
- fold is a pure function of valid history plus explicitly bound parent state;
- folding a prefix then its suffix equals folding the complete stream;
- no valid prefix has negative available/reserved/charged counters;
- a terminal prefix cannot accept later events;
- event sequence and record-hash continuity cannot be bypassed;
- accepted revisions form a strictly increasing, hash-linked chain;
- a rejected patch does not alter the current revision;
- seen keys never disappear;
- dry count changes only on committed dry/non-dry round facts;
- full-envelope preflight prevents partial work when the envelope cannot fit;
- stale leases and stale patch bases never win;
- replay never invokes handlers; and
- TypeScript and Python either accept to identical canonical state or reject
  with the same normalized error category and path.

Fuzz runs must be seeded and reproducible in CI, retain minimized counterexample
fixtures, cap examples/time/bytes, and avoid network/model dependencies. Add a
longer nightly profile and a bounded pull-request profile.

### 31.17 Performance and scalability budgets

Establish benchmarks before optimizing. Measure both languages on the same
fixture families and publish methodology, hardware, warm-up, samples, and
variance.

Benchmark dimensions:

- request validation by document size;
- event construction, canonical serialization, hashing, prospective fold, and
  append latency;
- full replay by event count and candidate/seen cardinality;
- checkpoint-assisted replay;
- GraphPatch validation and compilation by appended node/edge count;
- concurrent local and PostgreSQL writers;
- memory retained per event, seen key, verdict, revision, and checkpoint;
- fork lineage resolution depth;
- conformance runner duration; and
- package import/startup time.

Initial engineering budgets, to be calibrated with evidence:

- no accidental quadratic replay in ordinary event-count growth;
- bounded candidate and patch bytes enforced before expensive compilation;
- 10,000-event local full replay completes within a documented developer-grade
  budget without unbounded memory;
- checkpoint restore provides a material measured improvement at long history;
- a rejected oversize input exits before handler or compiler dispatch; and
- benchmark regression thresholds account for variance and never encourage
  disabling correctness checks.

Performance changes require correctness and security gates first. Do not cache
unvalidated state or weaken prospective-fold/CAS semantics to improve a chart.

### 31.18 Public API, compatibility, and migration policy

Before beta:

- document which D7 symbols are public, experimental, or internal;
- provide one namespace-consistent TypeScript and Python API map;
- stabilize structured error codes and JSON pointer conventions;
- define event/checkpoint/request/patch API version compatibility windows;
- write migration adapters only for explicitly supported source versions;
- reject unknown future required fields fail-closed;
- preserve unknown optional extension data only where the contract explicitly
  permits it;
- test old reader/new writer and new reader/old writer combinations;
- publish deprecation periods and removal policy;
- add changelog entries with upgrade impact and recovery procedure; and
- prove package exports, type declarations, Python type markers, and source
  distributions contain the intended D7 surfaces.

Never mutate committed event bytes during migration. Migrations either transform
a copy into a new explicitly versioned stream or teach the reader to interpret
an older immutable version.

### 31.19 Examples, course material, and newcomer success

Build examples that teach graph shape and operational safety, not just API
syntax:

1. redraw a needless linear chain into independent fan-out and a real barrier;
2. fan out research, reduce deterministically in code, and synthesize once;
3. pipeline independent items without a global barrier;
4. route a low/high-risk review based on validated classifier output;
5. verify findings through correctness, security, and reproduction lenses;
6. run an until-dry discovery loop that dedupes against all seen candidates;
7. demonstrate budget preflight stopping with zero dispatch;
8. crash after a committed discovery and safely resume without rerunning it;
9. show an interrupted non-idempotent activity blocking with a remediation
   explanation;
10. apply one accepted GraphPatch and inspect its revision evidence;
11. reject a stale or unauthorized patch with stable diagnostics;
12. replay and fork an exact prefix;
13. compare full replay with checkpoint-assisted replay; and
14. run the same fixture in TypeScript and Python.

Each example needs README context, architecture diagram where it materially
clarifies flow, copy/paste commands, expected output, bounded budgets, failure
exercise, test, CI invocation, version pin, and honest production boundary.

Run moderated usability sessions with at least five users unfamiliar with the
implementation. Measure time to first valid graph, time to diagnose one
intentional failure, completion rate, wrong mental models, docs search paths,
and recovery success. Convert every repeated failure into a tracked docs/API
task.

### 31.20 Security review and threat-model update

Update the threat model with D7-specific assets and attackers.

Assets:

- immutable event history and record hashes;
- lease/fence authority;
- budget ledger and reserved capacity;
- activity implementation identity and idempotency key;
- GraphPatch authority snapshots and revision chain;
- candidate values and verdicts;
- checkpoints and lineage manifests; and
- protected support evidence.

Threats:

- forged or truncated history;
- stale owner writes after takeover;
- malicious activity output exhausting parser/compiler resources;
- patch privilege escalation or capability laundering;
- candidate-key collision or Unicode ambiguity;
- replay of an accepted patch against another base/run/tenant;
- checkpoint substitution;
- parent-lineage substitution;
- budget under-reservation, double release, or cost evasion;
- duplicate non-idempotent effect;
- log/support-bundle data exfiltration;
- denial of service through deep graphs, huge diagnostics, or pathological JSON;
- dependency or artifact substitution; and
- maintainer mistake during migration or emergency recovery.

For each threat, record prevention, detection, response, residual risk, test,
owner, and release gate. Obtain an independent security review and retain every
finding/disposition, including rejected findings, in append-only evidence.

### 31.21 CI and release evidence expansion

Add a D7 evidence manifest that binds:

- source commit/tree/parents;
- toolchain and dependency lock hashes;
- generated schema and fixture hashes;
- TypeScript package and Python wheel/sdist hashes;
- exact commands, platforms, and result counts;
- fuzz seeds and minimized regressions;
- database image/version and migration version;
- benchmark environment and raw results;
- reviewer identity/independence and dispositions;
- known limitations and intentionally skipped external gates; and
- remote branch/tag/artifact identities.

Required CI rows before D7 production claim:

- Node supported versions on Linux, macOS, and Windows where supported;
- Python 3.11, 3.12, and 3.13 on supported platforms;
- TypeScript native, Python native, and cross-language conformance;
- SQLite and PostgreSQL provider conformance;
- fault injection, cancellation, budget, patch, fork, and corruption matrices;
- deterministic property tests and bounded fuzz profile;
- package content and fresh-environment installation;
- documentation links/snippets/examples;
- license, provenance, SBOM, dependency audit, and secret scan;
- migration and backup/restore drill; and
- independent acceptance against an immutable release candidate.

A green branch is not a release. The candidate must be immutable, evidence must
refer to that exact object, and required external checks must finish on that
same candidate.

### 31.22 Detailed task contracts and dependency order

Create or update task-registry entries with these minimum contracts:

- **D7-H01 in-doubt semantics:** input current schemas/folds; output normative
  decision, fixtures, dual implementation, exact conformance; blocks stores and
  beta API; independent reviewer required.
- **D7-H02 boundary fault harness:** input event vocabulary; output derived fault
  matrix and retained results; depends on H01 event semantics.
- **D7-H03 cancellation matrix:** input handler harness and fake clock; output
  every-boundary tests; may run with H02 after shared harness ownership is set.
- **D7-H04 budget oracle:** input policy/request contracts; output independent
  ledger model, lattice fixtures, dual-runtime comparison; blocks production
  cost claims.
- **D7-H05 hostile GraphPatch suite:** input patch/revision/authority schemas;
  output generated malicious corpus and trust-boundary tests; blocks scheduler
  integration.
- **D7-H06 lineage model:** input fork semantics; output bounded lineage-tree
  fixtures, exporter, dual-runtime tests; blocks retention policy.
- **D7-S01 store provider contract:** input controller CAS requirements; output
  adapter interface, error taxonomy, reference model, conformance kit.
- **D7-S02 SQLite adapter:** depends on S01 and H01; output native adapters,
  migrations, crash tests, backup/restore evidence.
- **D7-S03 PostgreSQL adapter:** depends on S01/H01; output database-fenced native
  adapters and chaos evidence.
- **D7-S04 checkpoint acceleration:** depends on stable checkpoint projection;
  output validated fast path, fallback, equivalence and performance tests.
- **D7-I01 scheduler revision protocol:** depends on H05 and authority contract;
  output normative handoff and expected fixtures.
- **D7-I02 scheduler implementation:** depends on I01 plus at least reference
  durable store; output revision-aware scheduling and end-to-end tests.
- **D7-Q01 state-machine/property suite:** may start after H01 fixture decision;
  output seeded generators and minimized regressions.
- **D7-Q02 benchmark suite:** depends on stable public operations; output raw
  reproducible baselines and guarded thresholds.
- **D7-O01 protected operator views:** depends on D9 redaction/sink guard; output
  projections, CLI/API views, support bundle, leak tests.
- **D7-E01 examples/course:** depends on truthful alpha API; output tested
  bilingual examples and exercises.
- **D7-R01 compatibility/migration:** depends on stable beta candidate; output
  matrix, adapters, migration drills, docs.
- **D7-R02 independent acceptance:** depends on all required rows; output hostile
  review, disposition ledger, immutable evidence, and explicit accept/reject.

Every task contract must include exact owned paths, forbidden shared paths,
maximum retry/fan-out/time budget, expected artifacts, expected tests, evidence
path, rollback/recovery procedure, and next dependency. “Improve robustness” or
“finish tests” is not a valid task description.

### 31.23 Execution waves for maximum safe speed

Wave 1 can run H01 design, H04 oracle design, H05 corpus design, H06 lineage
fixtures, and S01 provider-contract drafting in parallel because their outputs
are separable. Root ownership resolves any contract conflict before code edits.

Wave 2 runs H02/H03 harness implementation, H04/H05/H06 dual-runtime code, S02
SQLite implementation, and Q01 generators. Shared schemas are frozen per
candidate while these lanes execute.

Wave 3 runs S03 PostgreSQL, S04 checkpoint acceleration, I01 scheduler revision
protocol, and initial E01 material against the verified alpha surface.

Wave 4 runs I02 scheduler integration, O01 protected operator views, Q02
benchmarks, full storage chaos, migration design, and complete examples.

Wave 5 creates one immutable release candidate and runs the entire native,
cross-language, database, chaos, security, package, docs, usability, and
compatibility matrix. Failures create new commits and a new candidate; evidence
must never be rebound to changed bytes.

Wave 6 is independent acceptance, release authorization, artifact publication,
public identity verification, support readiness, and post-release monitoring.

Parallelism rules:

- prefer independent fixture/spec/review tasks over multiple agents editing one
  implementation file;
- give each writer a disjoint worktree or path set;
- cap every agent's retries, fan-out, runtime, and write scope;
- run deterministic reductions in code rather than spending model calls on
  flatten/dedupe plumbing;
- put barriers only where cross-item comparison truly needs the whole set;
- preserve all failed tests and rejected findings as evidence; and
- stop dispatch when an unresolved contract decision would cause incompatible
  implementations.

### 31.24 Organic adoption plan tied to product quality

The repository may target 5,000 and later 6,000 authentic GitHub stars, but it
must pursue them through user value and community trust:

- a truthful one-command quickstart that succeeds in a fresh environment;
- a compelling bilingual TypeScript/Python native-cycle demo;
- clear architecture diagrams and a 14-step graph-engineering course grounded
  in executable repository code;
- comparison pages based on reproducible capabilities rather than attacks or
  unverifiable superiority claims;
- small, reviewable `good first issue` and `help wanted` tasks with maintainer
  response targets;
- regular changelogs, roadmap truth, release notes, and public known limits;
- examples contributed by real users and adapters maintained with explicit
  ownership;
- talks, articles, demos, and launch posts that link to tested artifacts;
- prompt issue/PR triage, a code of conduct, security policy, support policy, and
  governance path; and
- privacy-respecting adoption measurements such as quickstart completion,
  repeat contributors, issue resolution, release downloads, documentation task
  success, and retained production users.

Forbidden growth tactics include purchased stars, automated starring, spam,
misleading benchmarks, concealed sponsorship, fake users, forced engagement,
or claiming Andrew Ng/Claude/X endorsement without verifiable authorization.
Star count never overrides security, evidence, licensing, privacy, or release
quality.

Suggested adoption milestones are observational, not guaranteed deadlines:

- 100 authentic stars: validate positioning and quickstart completion;
- 500: validate contributor onboarding and recurring external use cases;
- 1,000: validate support load, governance, and package reliability;
- 2,500: validate adapter ecosystem and stable migration process;
- 5,000: validate broad awareness without weakening technical truth; and
- 6,000+: sustain quality, compatibility, security response, and contributor
  health rather than optimizing only for acquisition.

At each milestone, publish product evidence and community lessons, not a claim
that popularity proves correctness.

### 31.25 D7 production-claim acceptance checklist

D7 may be described as production-ready only when every applicable row below is
green on one immutable candidate and independent review accepts it:

- [ ] in-doubt cardinality/resolution semantics are normative and identical in
      TypeScript and Python;
- [ ] every durable event boundary has bounded crash/commit-then-throw coverage;
- [ ] cancellation and timeout matrices cover every meaningful activity phase;
- [ ] an independent budget oracle validates every event prefix and boundary;
- [ ] hostile GraphPatch validation covers structure, authority, resources,
      replay, restore, and concurrency;
- [ ] replay/fork lineage trees pass corruption, missing ancestor, sibling, and
      cycle tests;
- [ ] provider-neutral CycleStore conformance is published and enforced;
- [ ] SQLite restart/CAS/backup/migration tests pass in both languages;
- [ ] PostgreSQL fencing and failover chaos tests pass in both languages;
- [ ] stale owners cannot append after takeover;
- [ ] checkpoint acceleration is byte-equivalent to full fold and safely falls
      back on corruption;
- [ ] ordinary scheduler applies accepted revisions exactly once and never
      accepts implicit unbounded cycles;
- [ ] D9-protected operator views and support bundles pass leak tests;
- [ ] seeded property/differential/state-machine suites pass and retain
      counterexamples;
- [ ] performance budgets are documented and measured without weakening
      validation;
- [ ] compatibility/migration matrices and immutable-event policy are tested;
- [ ] package contents and clean wheel/sdist/npm installation include the
      intended public surfaces;
- [ ] examples, snippets, and course exercises execute in CI;
- [ ] supported OS/runtime/database matrices pass on the exact candidate;
- [ ] provenance, SBOM, dependency, license, and secret gates pass;
- [ ] independent technical and security reviewers close every disposition;
- [ ] public documentation lists remaining non-claims and supported boundaries;
- [ ] release artifacts, source tag, evidence manifest, and public checks bind
      the same commit/tree; and
- [ ] the no-omission audit in section 29 is repeated after this entire appendix
      is inventoried into the task registry.

### 31.26 Immediate next implementation sequence

The next concrete development sequence after baseline
`a6c8e67c56d9ebcd8596307d9166763f48ac8713` is:

1. write the immutable D7 baseline evidence record with exact local/remote
   identities and clean-worktree commands;
2. preserve D7 TS and Python task states as `in_progress` until independent
   hostile review and the full boundary matrix complete;
3. resolve H01 in-doubt semantics with expected fixtures before implementation;
4. add exact cross-language cases for rejected GraphPatch, resume/fork blocked
   by non-idempotent claim, cancellation boundaries, and budget one-below/at/
   above cases;
5. derive the durable-boundary fault harness from the event vocabulary;
6. add the independent budget ledger oracle;
7. extend hostile GraphPatch and lineage suites;
8. specify the CycleStore provider contract before writing SQLite/PostgreSQL;
9. implement and validate checkpoint-assisted restore;
10. freeze the scheduler revision handoff contract before integration code;
11. rerun full native/cross-language/package/docs/security gates in a clean
    candidate worktree;
12. request independent hostile review when agent/reviewer capacity is
    available; and
13. append all discoveries, failures, superseding evidence, and newly required
    work without changing any earlier plan bytes.

Completion of this section means the implementation, tests, production stores,
integration, evidence, documentation, migration, security review, usability,
and release gates actually exist and pass. It does not mean the checklist was
copied into a log, that an author reviewed their own work, or that a popularity
number was reached.

## 31.27 Append-only H05C hostile replay/restore execution contract (2026-07-27)

This section was appended after sections 1-31.26 and does not supersede or edit
any prior requirement. It converts the replay/restore portion of the existing
D7-H05 production-claim gate into a concrete, independently reproducible
milestone. At append time, the implementation and focused/cross-language gates
described below have passed in the shared development tree; immutable commit,
cold-worktree, and retained evidence identities remain required before this
milestone may be cited as closed release evidence.

### 31.27.1 Objective and non-negotiable boundary

The objective is to ensure that a durable `PatchAccepted` or `PatchRejected`
record cannot bypass any validation performed by a live GraphPatch application.
Restore is a trust boundary, not a deserialization convenience. A syntactically
valid, re-signed, or hash-shaped event is still hostile until all embedded
evidence is rebound and the accepted graph is independently reconstructed.

The implementation MUST satisfy all of the following simultaneously:

- TypeScript and Python consume the same logical durable carrier and reach the
  same portable outcome, error code, graph coordinate, decision cardinality,
  dynamic-node cardinality, and graph-node cardinality;
- the complete accepted and rejected seed carriers created by the public live
  appliers are byte-identical across native runtimes before any mutation is
  introduced;
- carrier validation occurs before graph, coordinate, dynamic-node, or decided
  patch-ID state changes;
- accepted history is recompiled and checked against current runtime limits
  rather than trusting a recorded resulting graph hash;
- rejected history cannot claim accepted-only evidence, an empty diagnostic
  set, a dynamic-node commit, or an unknown code;
- stale-base rejection history remains recoverable after its winning accepted
  sibling advanced the coordinate;
- every non-stale new decision binds exactly to the currently reconstructed
  coordinate;
- exact duplicate history is a no-op even when later accepted revisions have
  advanced beyond the duplicated decision's requested base;
- a complete-evidence conflict under an already restored patch ID fails with
  `GE_PATCH_IDEMPOTENCY_CONFLICT` and preserves the first record; and
- no regular-expression-shaped but unknown diagnostic/error code is admitted
  into durable state.

### 31.27.2 Frozen corpus and independent vocabulary closure

The retained fixture is
`spec/conformance/graph-patch-hostile-restore.case.json`. Its immutable logical
identity for this milestone is:

- protocol ID: `graph-patch-hostile-restore-v1alpha1`;
- total cases: 34;
- hostile fail-before-mutation attacks: 27;
- stateful restore/idempotency behaviors: 7;
- canonical ordered-case byte count: 6,216 UTF-8 bytes; and
- canonical ordered-case SHA-256:
  `4e08a710822f20ad58e8ae563ebe21eeb9fdd98926e3c3c12fbafa575bd36372`.

The 27 attack cases cover closed shape, patch identity, inline-payload
canonicality and length, requested-base binding, planner/authority/policy
binding, negative and unreconciled budgets, accepted node accounting,
diagnostic outcome consistency, revision number/previous hash/patch hash/
revision hash/graph hash lineage, cumulative dynamic-node and graph-node
limits, rejected error-code vocabulary, and rejected budget accounting.

The seven behavior cases cover one accepted restore, one rejected restore, a
post-winner stale rejection, two accepted revisions in order, an immediate
exact accepted duplicate, a historical accepted duplicate after a later
revision, and a complete-evidence duplicate conflict.

The repository fixture validator MUST enforce all of the following without
delegating to either native runtime:

1. exact fixture version and canonical diamond-graph reference;
2. unique IDs and unique scenarios;
3. exact 34-scenario closed vocabulary;
4. exact per-category counts;
5. exact accepted/rejected/mixed seed vocabulary;
6. exact restored/duplicate-reused/restore-rejected outcome vocabulary;
7. `expectCode` presence only for restore rejection;
8. `GE_CYCLE_INVALID_HISTORY` for all 27 pre-state attacks;
9. `GE_PATCH_IDEMPOTENCY_CONFLICT` only for the stateful conflicting duplicate;
10. exact attack/behavior cardinality;
11. exact ordered canonical byte count and SHA-256; and
12. exact required-assertion vocabulary.

### 31.27.3 TypeScript runtime obligations

`NativeGraphPatchApplier.restoreRecorded` and its durable-decision validator
MUST:

- capture bounded portable JSON and require an exact accepted or rejected key
  set;
- decode and validate the closed inline payload, including disposition,
  redaction claim, encoding, canonical JSON, byte length, and SHA-256;
- revalidate the embedded GraphPatch shape and bind patch ID and canonical hash;
- bind the embedded patch base to the separately recorded requested base;
- validate all authority hashes and bind the proposer to an independently
  folded planner activity key;
- validate the policy snapshot hash and exact budget reconciliation;
- admit only the nine stable GraphPatch public codes in diagnostics and
  rejected outcomes;
- validate diagnostic JSON Pointers and portable phases;
- require accepted decisions to have no diagnostics, exact appended-node
  accounting, and a valid one-step revision chain;
- require rejected decisions to have at least one diagnostic and zero dynamic
  node commitment;
- evaluate exact duplicate/conflict evidence before current-coordinate lineage
  checks;
- permit a new stale rejection only when its requested base differs from the
  current reconstructed coordinate;
- require every other new decision to match that coordinate;
- compile accepted candidates, compare the recorded graph/revision identities,
  enforce graph limits, and enforce cumulative dynamic-node limits before
  exposing state; and
- return `GE_CYCLE_INVALID_HISTORY`, never a live stale-base decision code, when
  stored lineage is internally inconsistent.

### 31.27.4 Python runtime obligations

`GraphPatchRuntime.restore` MUST apply the same trust boundary to complete
`CycleEvent.data`, including the controller-only `iteration` and
`plannerActivityKey` fields. It MUST normalize malformed carrier failures to
`GE_CYCLE_INVALID_HISTORY`, while preserving the distinct complete-evidence
duplicate conflict code.

Python validation MUST explicitly close and validate:

- the accepted/rejected event-data field sets and matching event outcome;
- portable iteration and duration bounds;
- inline payload fields, strict JSON decoding, canonical text, byte count, and
  digest;
- GraphPatch schema, patch identity, and requested coordinate;
- nine-field authority snapshot, optional approval hash, planner binding, and
  policy hash;
- exact requested/committed/released three-axis budgets and reconciliation;
- bounded diagnostics, known GraphPatch codes, phase range, and JSON Pointer;
- accepted diagnostic/node/revision invariants;
- rejected diagnostic/error/dynamic-node invariants;
- graph recompilation and recorded graph-hash equality;
- runtime graph-shape limits and cumulative dynamic-node lineage; and
- complete duplicate equality across patch bytes, hash, outcome, base,
  authority, policy, budget, diagnostics, resulting revision, error, and dry-run
  state.

### 31.27.5 Native and cross-language executable evidence

The TypeScript campaign runner is
`tools/conformance/graph_patch_hostile_restore.mjs`; the independent Python
runner is
`tools/conformance/python_graph_patch_hostile_restore_report.py`. Each runner
MUST generate its own public-applier seed decisions, materialize every mutation,
execute each case against a fresh target where required, and emit a deterministic
JSON report.

Every report case MUST include:

- stable index, ID, category, scenario, and attack/behavior kind;
- exact canonical input byte count and SHA-256;
- observed restore outcome and public error code;
- final graph coordinate;
- final decided-ID count;
- final cumulative dynamic-node count; and
- final graph-node count.

The report MUST also retain the complete four seed carriers with their exact
canonical byte counts and SHA-256 values. `tools/conformance/run.mjs` MUST parse
both reports and deep-compare the entire structures. Comparing only aggregate
counts, accepting runtime-local snapshots, or discarding a field before the
comparison does not satisfy this gate.

### 31.27.6 Required verification sequence

The milestone verification sequence is cumulative:

1. parse the fixture and independently recompute its canonical byte count and
   digest;
2. run Python Ruff and Mypy over the changed runtime and campaign runner;
3. run the focused Python GraphPatch runtime tests;
4. run the TypeScript runtime tests including the 34-case corpus;
5. run the independent repository fixture validator;
6. build the core, persistence, runtime, and primitives packages;
7. run the complete cross-language conformance suite and retain the line proving
   34 restore cases, 27 attacks, and seven behaviors matched;
8. run full TypeScript tests, lint, type checking, and builds;
9. run full Python tests, Ruff, and Mypy;
10. run documentation links, fixture validation, release-map, evidence-closure,
    package-content, packed-install, artifact, and production-dependency gates;
11. repeat the relevant gates from a detached clean worktree at the exact
    implementation commit;
12. write a retained evidence record containing commit/tree/parent identities,
    fixture identity, four seed carrier identities, exact commands and results,
    failures encountered, repair dispositions, dirty-worktree exclusions, and
    cold-worktree proof; and
13. commit the evidence record separately, verify exact author/committer and
    empty message body, push, fetch, and prove local/remote zero divergence.

No partial success may be collapsed into “H05 complete.” In particular, this
milestone closes hostile GraphPatch replay/restore behavior only. The original
D7 production-claim checklist still separately requires concurrency evidence,
lineage-tree replay/fork corruption coverage, provider conformance, production
stores, checkpoint equivalence, scheduler handoff, protected operator surfaces,
property/state-machine testing, packaging, platform matrices, provenance, and
independent review.

### 31.27.7 Evidence-at-append-time snapshot and next dispatch

At the moment this section was appended, the following development-tree gates
had passed:

- Python focused GraphPatch suite: 23 tests;
- TypeScript runtime suite after corpus integration: 191 tests across eight
  files in the invoked workspace filter;
- independent fixture validation including all 34 H05C descriptors;
- full cross-language conformance, including exact deep equality for the 34-case
  H05C report; and
- Ruff and Mypy for the changed Python runtime and runner.

This snapshot is informative, not immutable release evidence. The next dispatch
after H05C evidence closure MUST select the highest unblocked remaining item
from sections 31.25-31.26, favoring replay/fork lineage corruption or the
provider-neutral `CycleStore` contract because those gates unlock multiple
downstream production-readiness rows. New discoveries MUST be appended after
this section; earlier plan text and this historical snapshot remain unchanged.

## 31.28 D7-H06 multi-generation replay/fork lineage and offline manifest closure

This section was appended after the H05C implementation/evidence push. It does
not rewrite, narrow, reorder, or retroactively mark any earlier plan item. It
turns the previously selected D7-H06 lineage priority into an executable
contract and records the exact acceptance boundary for the implementation now
under verification.

### 31.28.1 Milestone outcome and non-claims

H06 MUST replace single-parent replay assumptions with a bounded, independently
verifiable root-to-target ancestry proof. A successful implementation provides:

- a closed `cycle-controller-lineage/v1alpha1` carrier;
- native TypeScript and Python exporters;
- native store-free offline replay in both runtimes;
- recursive fork-of-fork support rather than only start → child support;
- a machine-readable Draft 2020-12 schema;
- a generated root → child → grandchild topology;
- sibling forks from the same immutable parent prefix;
- a fork from a different valid prefix of the root;
- checkpoint-refold versus full-event-fold equivalence at an intermediate
  ancestor;
- corruption, omission, duplication, reordering, cycle, identity, and bound
  attacks that remain invalid even after the attacker recomputes the outer
  manifest hash; and
- complete TypeScript/Python canonical report equality.

H06 does **not** claim that the process-local memory stores are production
durable, that a lineage export authorizes ancestor garbage collection, that D9
payload protection is complete, or that SQLite/PostgreSQL retention and legal
hold behavior exists. It closes the replay/fork lineage proof row only. Store
provider conformance, durable retention enforcement, production adapters,
protected carriers, scheduler integration, release provenance, and independent
review remain separate gates.

### 31.28.2 Closed manifest envelope

The machine carrier MUST contain exactly these top-level fields:

1. `apiVersion` fixed to
   `graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1`;
2. `kind` fixed to `CycleControllerLineageManifest`;
3. `contractVersion` fixed to `cycle-controller-lineage/v1alpha1`;
4. truthful `payloadDisposition: inline-unredacted`;
5. truthful `redacted: false`;
6. the exact immutable `limits` object;
7. one closed target binding;
8. nonempty root-to-target `streams` in dependency order;
9. exact aggregate `eventCount`; and
10. `manifestHash`.

Unknown fields are forbidden at the envelope, limits, target binding, stream,
parent binding, event, request, and nested durable-payload levels. Validation
MUST first detach exact portable JSON under a canonical byte bound. Proxies,
accessors, hidden or symbol keys, sparse arrays, non-plain objects, cycles,
unsafe integers, non-finite values, and constructed-depth/value explosions
cannot cross the trust boundary.

The fixed contract bounds are:

- maximum ancestry depth: 32 parent edges;
- maximum streams: 33;
- maximum embedded events across the complete package: 1,024; and
- maximum canonical manifest bytes: 16,777,216.

These values are embedded in and authenticated by the manifest. A caller cannot
substitute smaller or larger numbers, omit a field, or treat them as local
configuration. Future bound changes require a versioned contract migration.

### 31.28.3 Stream and parent binding

Every stream entry MUST repeat a complete binding over:

- `controllerRunId`;
- `controllerId`;
- `hostRunId`;
- `eventStreamId`;
- inclusive `throughSequence`;
- terminal event `recordHash`;
- folded `historyPrefixHash`;
- `requestHash`; and
- `controllerHash`.

For the v1alpha1 event chain, `recordHash` and `historyPrefixHash` MUST be equal.
The embedded event count MUST equal `throughSequence + 1`, begin at sequence
zero with `ControllerCreated`, and survive complete event-integrity and semantic
fold validation. Derived request/controller/host/stream/hash values MUST equal
the repeated binding; repeated metadata is evidence to check, never an
authority source that can override the fold.

The first stream MUST have `origin=start` and `parent: null`. Every later stream
MUST have `origin=fork`; its `parent` object MUST equal the immediately preceding
stream binding byte-for-byte, and the child request's parent run ID, sequence,
and history hash MUST match that predecessor. The target binding MUST equal the
last stream binding. Run IDs and stream IDs MUST be unique throughout the
package. Therefore a missing root, missing middle ancestor, duplicate ancestor,
reordered list, self-reference, descendant-reference, or cycle fails before any
target state is exposed.

The physical target store key MUST equal the request's `eventStreamId`.
Lineage-capable store resolution by controller run ID MUST return exactly one
retained stream and exactly the requested inclusive prefix. A shorter prefix,
longer prefix, ambiguous controller index, substituted stream, or wrong tail
hash is invalid.

### 31.28.4 Content address and validation order

The manifest domain is exactly
`graph-engineering/cycle-lineage-manifest/v1alpha1\0`. `manifestHash` is SHA-256
over that UTF-8 domain separator followed immediately by canonical JSON for the
complete envelope excluding only `manifestHash`.

The validator order MUST be fail closed:

1. capture bounded exact portable JSON;
2. enforce the 16 MiB canonical byte maximum;
3. enforce closed envelope and fixed identity literals;
4. enforce the exact fixed limits;
5. validate the declared digest shape;
6. recompute and compare `manifestHash`;
7. validate target and stream binding shapes;
8. enforce stream, depth, event, and aggregate-count limits;
9. reject duplicate run/stream identities before reuse;
10. fold the root prefix;
11. fold each child using only the immediately preceding verified fold;
12. compare every derived binding to declared evidence;
13. compare every declared parent to the derived predecessor;
14. compare aggregate `eventCount`; and
15. compare the final derived binding to `target`.

Attack fixtures MUST recompute `manifestHash` after semantic mutation unless
the test explicitly targets an unsealed digest drift. This prevents a shallow
hash mismatch from hiding broken ancestry validation.

### 31.28.5 Native TypeScript surface

`@graph-engineering/runtime` MUST export:

- `exportCycleControllerLineageManifest`;
- `validateCycleControllerLineageManifest`;
- `replayCycleControllerLineageManifest`;
- `CYCLE_LINEAGE_MANIFEST_DOMAIN`;
- all four published limit constants;
- the manifest, stream, binding, limits, replay-result, and lineage-store
  TypeScript interfaces.

`CycleControllerLineageStore` extends the ordinary append/read event-store
surface with `readByControllerRunId(controllerRunId, throughSequence)`.
`MemoryCycleControllerEventStore` MUST implement this lookup deterministically,
reject absent or ambiguous controller identities, enforce that the physical
stream key equals the closed request stream ID on first append, and prevent one
controller run ID from being indexed by another stream.

`forkCycleController` MUST retain its direct fast path for an `origin=start`
parent. When the parent is itself a fork, it MUST require a lineage-capable
store, export/validate the complete ancestry through the requested parent
prefix, and use only the verified target fold as inheritance authority. It MUST
fail with `GE_CYCLE_INVALID_HISTORY` before child creation when the capability
or any ancestor is missing. A caller-built or serialized projection is not
trusted merely because it repeats a real history hash.

### 31.28.6 Native Python surface

`graph_engineering` MUST export:

- `export_cycle_lineage_manifest`;
- `validate_cycle_lineage_manifest`;
- `replay_cycle_lineage_manifest`;
- `CycleLineageReplayResult`;
- the common domain and limit constants.

Python's existing `CycleStore.read_by_controller_run_id` capability MUST be the
ancestor resolver. `MemoryCycleStore` MUST enforce the request's physical
stream key, retain one controller-to-stream index, reject ambiguous reuse, and
return only the requested inclusive prefix. Recursive controller replay/fork
resolution and manifest export MUST converge on the same depth and event
bounds as TypeScript.

The replay result MUST expose all root-to-target folds and a target property.
It performs no store operation because the manifest owns every required event
prefix. `require_terminal` may strengthen replay acceptance but cannot weaken
any ancestry, hash, or bound check.

### 31.28.7 Generated behavioral topology

The retained native unit topology MUST be produced with real controller APIs,
not handcrafted projection dictionaries:

```text
root prefix at terminal tail ──► fork A ──► fork B
             │
             ├───────────────► sibling fork
             │
             └─ root sequence 0 ─────────► early-prefix fork
```

Required observations:

- fork B exports three streams in root/A/B order;
- sibling and B exports contain byte-identical retained root entries;
- sibling and B target identities differ;
- root state is inherited by both branches;
- sibling-only discoveries, verdicts, counters, and arrays never appear in B;
- distinct-prefix export retains exactly the one root event named by sequence
  zero rather than silently extending to the current root tail;
- target, sibling, early-prefix, and root event bytes are unchanged by export
  and offline replay;
- intermediate fork A checkpoint validation produces a verified fold;
- folding B from that checkpoint-verified A fold equals folding B from the full
  event-derived A fold; and
- isolating a child stream without its parent makes export fail.

Existing open-activity fork tests remain required: an external idempotent or
non-idempotent parent claim is coalesced into one child in-doubt projection and
blocks child lease/dispatch under the current normative rule because the child
cannot reuse the parent's stable activity key.

### 31.28.8 Retained hostile campaign

`spec/conformance/cycle-controller-lineage.case.json` MUST remain a closed,
hashed 20-case vocabulary: four behaviors and 16 attacks.

The four behaviors are:

1. root → child → grandchild replay;
2. sibling-prefix equality with isolated target identity;
3. forks from root sequence zero versus root sequence one; and
4. deterministic byte-identical revalidation.

The 16 attacks cover:

1. unknown envelope field;
2. API-version substitution;
3. fixed-limit substitution;
4. unsealed event-count mutation;
5. missing root ancestor;
6. duplicate root ancestor;
7. ancestry-cycle identity;
8. reordered ancestors;
9. parent request-hash substitution;
10. parent event-byte corruption;
11. truncated parent prefix;
12. target controller-hash substitution;
13. resealed aggregate event-count mismatch;
14. record/prefix-hash disagreement;
15. stream-ID substitution; and
16. stream-count overflow.

All 16 attacks MUST return `GE_CYCLE_INVALID_HISTORY`. The fixture validator
MUST freeze the exact scenario set, unique IDs, allowed fields, category counts,
four/16/20 totals, required-assertion uniqueness, and canonical case-list byte
count/hash. The manifest schema MUST be independently meta-validated, compiled
with the referenced event schema, exercised with a valid event package, and
shown to reject an open stream entry.

### 31.28.9 Independent cross-language proof

The TypeScript runner is
`tools/conformance/cycle_controller_lineage.mjs`; the Python runner is
`tools/conformance/python_cycle_lineage_report.py`. Each MUST independently:

- derive requests from the shared controller fixture;
- calculate native request and controller hashes;
- create root `ControllerCreated` and `LeaseAcquired` events;
- create child, grandchild, sibling, and early-prefix creation events;
- write those events through its native memory store;
- export all three retained manifests;
- execute all behavior and attack scenarios;
- reseal semantic attacks with the native domain-hash implementation;
- replay or reject every case; and
- emit deterministic JSON containing the entire canonical grandchild manifest,
  byte count, raw SHA-256, manifest hash, stream/event totals, category totals,
  and ordered per-case results.

`tools/conformance/run.mjs` MUST deep-compare the complete reports. H06 is not
green if only counts, hashes, or selected fields match. The initial retained
portable package identity is:

- canonical manifest bytes: 18,392;
- raw canonical SHA-256:
  `67b436c51ea8395b380579453758ffed0273cecef6ac4f4a012981c18bc01084`;
- domain-separated manifest hash:
  `05f3503d99ba4918e6430843534ad739cd5dc0fe59a0fca4bd6ab33787df4d58`;
- streams: three; and
- embedded events: four.

Any intentional carrier change MUST update the protocol version or append a
documented migration with new fixture identities; silent golden regeneration
is forbidden.

### 31.28.10 Verification and immutable evidence sequence

H06 verification MUST include, in order:

1. TypeScript runtime strict type checking;
2. focused TypeScript lineage/tree/controller tests;
3. Python Ruff over runtime, store, tests, and independent runner;
4. Python Mypy over all changed runtime source;
5. focused Python lineage/controller tests;
6. independent fixture/schema validation;
7. documentation-link validation;
8. full cross-language conformance with the explicit 20-case H06 success line;
9. full TypeScript workspace tests, lint, type checking, and builds;
10. full Python tests, Ruff, and Mypy;
11. release-map, evidence-closure, package contents, packed-install, Python
    wheel/sdist, and production dependency audit gates;
12. a detached clean-worktree repeat at the exact implementation commit;
13. a retained evidence record with commit/tree/parent, fixture/package hashes,
    exact commands/counts, repairs, limitations, dirty-worktree exclusions, and
    cold-worktree identity;
14. a separate evidence commit; and
15. push, fetch, author/committer/body audit, and local/remote zero-divergence
    proof.

At append time, the focused TypeScript three-test lineage group, focused Python
two-test lineage group, schema/fixture validator, documentation links, strict
type/lint checks, and full cross-language suite were green. The complete suite
reported H06 parity for all 20 cases before continuing through the pre-existing
132-event/855-obligation native-cycle join. This is a development snapshot;
only the later immutable evidence record may be cited as commit-bound proof.

### 31.28.11 Immediate next dispatch after H06

After H06 immutable evidence is pushed, the next highest-leverage D7 item is
`D7-S01 provider-neutral CycleStore conformance`. Work SHOULD fan out by
independent ownership when agent capacity exists:

- contract owner: provider interface, CAS/append/read/index/checkpoint/lease and
  retention semantics;
- TypeScript owner: reference model and conformance harness;
- Python owner: independent reference model and differential report;
- adversarial owner: linearizability, pagination, stale-owner, ambiguous commit,
  duplicate request, truncation, corruption, and authorization cases;
- main agent: schema/public API integration, cross-language comparison, plan/log
  append-only integrity, full verification, cold proof, commits, and push.

S01 MUST define the capability and failure taxonomy required by SQLite and
PostgreSQL before either adapter is allowed to become the primary focus. It
must not encode memory-store implementation details as the provider contract.
Until additional agent slots recover, the main agent executes these workstreams
sequentially while preserving their independent artifacts and comparison
boundaries; quota failure does not justify weakening acceptance.

## 31.29 D7-S01 provider-neutral CycleStore contract and conformance closure

This section is appended after the immutable H06 evidence push. It does not
rewrite, narrow, reorder, or mark complete any earlier plan item. It converts
the production-store prerequisite in section 31.10 into an executable contract
that SQLite and PostgreSQL adapters must satisfy without inheriting
process-local memory-store assumptions.

### 31.29.1 Outcome and explicit non-claims

S01 MUST publish a closed, versioned provider contract with native TypeScript
and Python reference models and a shared adversarial conformance campaign. It
MUST settle the meanings of append CAS, immutable record bytes, snapshot
pagination, checkpoint caching, mutation idempotency, lease fencing, tenant
authorization, provider limits, schema discovery, migration exclusion,
retention declarations, backup declarations, error envelopes, and safe
observability before a durable adapter is accepted.

S01 does **not** claim:

- that the memory reference model is crash durable;
- that its process-local lock is distributed fencing;
- that SQLite supports multi-host ownership;
- that PostgreSQL migrations, backups, or failover have run;
- that controller code has switched to a production adapter;
- that checkpoints are authoritative;
- that D9 protected payloads or key management are complete;
- that retention declarations prove an operational archive or legal-hold
  drill;
- that release readiness or project popularity targets are complete; or
- that generic success from an adapter which throws unclassified exceptions is
  evidence.

The reference model is an executable oracle. Production claims remain blocked
on S02/S03 native adapters and their database/process-loss evidence.

### 31.29.2 Owned paths and shared-work exclusions

S01 owns these new or directly integrated paths:

- `packages/runtime/src/cycle-store-provider.ts`;
- `packages/runtime/test/cycle-store-provider.test.ts`;
- the matching export block in `packages/runtime/src/index.ts`;
- `python/src/graph_engineering/cycle_store_provider.py`;
- `python/tests/test_cycle_store_provider.py`;
- the matching imports and `__all__` entries in
  `python/src/graph_engineering/__init__.py`;
- `spec/cycle-store-provider.schema.json`;
- `spec/cycle-store-provider-semantics.md`;
- `spec/conformance/cycle-store-provider.case.json`;
- `tools/conformance/cycle_store_provider.mjs`;
- `tools/conformance/python_cycle_store_provider_report.py`;
- the bounded integration in `tools/conformance/run.mjs`;
- the bounded integration in `scripts/validate-fixtures.mjs`;
- root/runtime/Python/spec documentation and changelog entries;
- a new daily log entry or append to the current day's owned log;
- this append-only plan section; and
- a later immutable S01 evidence record.

S01 MUST NOT absorb, stage, rename, or normalize the unrelated D4 trace,
D9 redaction/protected carrier, D10 budget/router, subgraph-edge, security-plan,
task-registry, or progress-scanner work currently present in the shared tree.
Any unavoidable overlap in a shared integration file MUST be inspected and
staged by exact path and exact hunk ownership.

### 31.29.3 Contract identity and descriptor

The portable descriptor MUST be a closed object with:

1. `apiVersion` fixed to
   `graphengineering.reacher-z.github.io/cycle-store-providers/v1alpha1`;
2. `kind` fixed to `CycleStoreProviderDescriptor`;
3. `contractVersion` fixed to `cycle-store-provider/v1alpha1`;
4. a safe `providerId`;
5. an exact positive integer `schemaVersion`;
6. a compatibility window for minimum/maximum reader and writer versions;
7. fixed resource limits;
8. fixed online guarantees;
9. closed provider capability declarations;
10. payload-protection and observability declarations;
11. migration-lock and governance declarations; and
12. a domain-separated descriptor hash.

The reference descriptor MUST identify itself as process-local and
non-production-durable. The contract MUST allow later durable providers to
declare stronger capabilities, but a provider cannot claim a guarantee outside
the closed vocabulary. Unknown fields and unknown enum values fail before any
provider operation.

The contract-level fixed limits are initially:

- maximum append records per atomic batch: 64;
- maximum canonical bytes per record: 1,048,576;
- maximum canonical bytes per append batch: 8,388,608;
- maximum page size: 256 records;
- maximum checkpoint canonical bytes: 16,777,216;
- maximum lease TTL: 86,400,000 milliseconds;
- maximum safe sequence, epoch, fence, and schema integer:
  9,007,199,254,740,991; and
- maximum identifier length: 128 ASCII-safe characters unless a narrower
  existing controller contract applies.

Providers MAY advertise smaller operational limits but MUST never accept a
request above their advertised bound or advertise a value above the contract
ceiling. Limit refusal uses the exact quota or invalid-argument code specified
below and performs zero mutation.

### 31.29.4 Provider record and tail model

The provider stores a closed record carrier rather than interpreting arbitrary
controller business semantics. Every record MUST bind:

- stable record/event identity;
- exact nonnegative sequence;
- previous record hash, or `null` only at sequence zero;
- application record hash;
- canonical value hash;
- immutable portable JSON value; and
- exact canonical byte length.

The provider MUST detach caller-owned values before awaiting or committing.
After append, caller mutation cannot change any read, hash, cursor, checkpoint,
backup, or metric. A read returns detached values and cannot expose mutable
provider state.

An empty stream tail is exactly `{ sequence: -1, recordHash: null }`. A nonempty
tail is exactly the committed final sequence/hash pair. Tail reads used for
ownership transfer are strongly consistent and cannot come from an eventually
consistent replica.

### 31.29.5 Atomic append and operation idempotency

`append` MUST accept:

- authorization context and tenant identity;
- one globally stable mutation `operationId` within that tenant;
- stream identity;
- exact expected tail sequence and expected tail hash;
- an exact active lease binding when the stream has entered fenced ownership;
  and
- one to 64 contiguous records.

Validation order is normative:

1. capture and close the request;
2. validate contract/schema version and limits;
3. authorize operation and tenant;
4. consult the mutation idempotency ledger;
5. validate stream/tail and active fence;
6. validate every record's canonical bytes, value hash, sequence, identity,
   previous hash, and batch-local chain;
7. commit every record plus the idempotency outcome atomically; and
8. return the new tail.

No prefix may commit. An exact repeated operation ID with byte-identical
canonical request returns the first canonical result even when the stream has
advanced, the lease later expired, or the original acknowledgement was lost.
Reuse of the operation ID with any changed operation name or request byte is an
idempotency conflict and performs zero mutation. The idempotency check precedes
ordinary CAS so commit-then-throw recovery is possible.

Record IDs MUST be unique within a tenant. A record cannot be indexed under two
streams. Reusing a record ID, breaking sequence/previous-hash continuity,
supplying the wrong expected hash, or changing committed bytes fails closed.

### 31.29.6 Exact snapshot pagination

Event reads MUST expose bounded pages, not an unbounded provider-specific
iterator. The initial request names tenant, stream, `fromSequence`, and page
size. The first response fixes a snapshot tail. A continuation cursor MUST be
opaque, integrity protected, single-contract-version, and bound to:

- tenant and authorization scope;
- stream;
- next sequence;
- snapshot tail sequence and record hash;
- provider/schema version; and
- cursor expiry or provider-retained cursor lifetime policy.

Continuation pages MUST neither skip nor duplicate a record. Appends after the
first page are excluded from that cursor's snapshot and appear only in a new
scan. A cursor cannot be combined with a new `fromSequence`, page size, tenant,
stream, principal, or provider version. Unknown, expired, malformed, replayed
under another scope, or integrity-drifted cursors use the exact invalid-cursor
code. Cursor errors perform zero reads beyond metadata lookup and leak no
record payload.

An initial `fromSequence` beyond the fixed tail returns one empty final page,
not an infinite cursor or a fabricated not-found record. A missing stream is
distinguished from an existing empty stream by the tail response.

### 31.29.7 Checkpoints remain disposable caches

Checkpoint operations MUST include save, load, list, and delete. A checkpoint
binds tenant, scope, checkpoint ID, stream, exact event tail sequence/hash,
content hash, canonical byte length, created-at value, and portable JSON body.

Checkpoint save MUST:

- be an idempotent mutation with an operation ID;
- require the exact current event tail and active lease binding when fenced;
- reject a checkpoint whose declared content hash or byte length drifts;
- reject a checkpoint ahead of, behind, or bound to another stream tail;
- keep one checkpoint ID immutable unless it is first deleted; and
- commit no event record.

Checkpoint list ordering is deterministic: descending bound sequence, then
descending creation timestamp, then checkpoint ID as the final bytewise tie
breaker. Listing is snapshot-paginated under the same no-skip/no-duplicate
rules as events.

Delete is idempotent, requires the expected content hash when the checkpoint
exists, and never deletes events. Missing checkpoints return a closed absent
result. Corrupt checkpoint bytes return the corruption code; controller logic
MUST fall back to authoritative event folding. A provider MUST NOT silently
repair, reinterpret, or promote a checkpoint to authoritative state.

### 31.29.8 Lease lifecycle and fencing

The provider owns the authoritative clock used for leases. Callers request a
bounded TTL; they do not submit trusted acquisition or expiry timestamps.

Lease operations MUST include acquire, renew, release, inspect, and takeover.
The closed lease identity binds tenant, stream, lease ID, holder ID, epoch,
fencing token, provider acquisition time, and provider expiry time.

Rules:

- the first successful acquisition starts epoch/fence at a positive value;
- every later successful acquisition or takeover strictly increases both;
- renew preserves lease ID, holder, epoch, and fence while strictly extending
  expiry;
- release requires the exact active identity and retains the last epoch/fence;
- acquisition while another unexpired lease is active is a lease conflict;
- takeover before expiry is a lease conflict;
- takeover after expiry still requires the caller's expected prior fence;
- a stale or substituted lease/fence is `GE_CYCLE_STORE_STALE_FENCE`;
- append and checkpoint save after ownership begins require the exact active,
  unexpired lease identity;
- expiry or release blocks writes until a new higher fence is acquired;
- exact mutation retry is resolved from the idempotency ledger before current
  expiry/fence checks; and
- epoch/fence overflow fails without mutation.

The process-local reference model exercises these semantics but declares
`distributedFencing: false`. Only a database-enforced implementation may later
declare true distributed fencing.

### 31.29.9 Closed error taxonomy

Every provider failure MUST be a serializable `CycleStoreProviderError` with
exact name, code, operation, retryable boolean, safe message, and closed details.
The v1alpha1 codes are:

- `GE_CYCLE_STORE_INVALID_ARGUMENT`;
- `GE_CYCLE_STORE_INVALID_CURSOR`;
- `GE_CYCLE_STORE_NOT_FOUND`;
- `GE_CYCLE_STORE_CONFLICT`;
- `GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT`;
- `GE_CYCLE_STORE_LEASE_CONFLICT`;
- `GE_CYCLE_STORE_STALE_FENCE`;
- `GE_CYCLE_STORE_UNAVAILABLE`;
- `GE_CYCLE_STORE_CORRUPTION`;
- `GE_CYCLE_STORE_QUOTA_EXCEEDED`;
- `GE_CYCLE_STORE_PERMISSION_DENIED`;
- `GE_CYCLE_STORE_UNSUPPORTED_VERSION`;
- `GE_CYCLE_STORE_LEGAL_HOLD`;
- `GE_CYCLE_STORE_MIGRATION_LOCKED`; and
- `GE_CYCLE_STORE_INTERNAL` only as a last-resort boundary translation which
  cannot count as a successful expected conformance outcome.

Conflict, permission, corruption, quota, version, lease, and cursor cases MUST
never pass because an adapter throws a generic exception. Conformance compares
exact code, operation, retryability, safe detail keys, and zero-mutation proof.
Messages and details MUST omit record values, checkpoint bodies, authorization
secrets, encryption material, and raw database errors.

### 31.29.10 Tenant, authorization, protection, and observability

Every online/admin request is tenant scoped and carries a principal hash plus a
policy/authorization snapshot hash. Providers invoke an authorization hook
before state lookup that could reveal existence. The same stream/checkpoint ID
MAY exist independently in separate tenants. A denied actor cannot distinguish
missing from existing protected state through code, details, timing class, or
metrics exposed to that actor.

The provider contract stores already-classified portable carriers. It MUST
declare whether payload protection is external, provider-managed, or absent.
S01's reference model declares external/none-for-tests and never claims D9
completion. Durable providers must integrate protected carriers before writing
classified raw payloads and must not leak them through errors, tracing, query
logs, metrics labels, or backup metadata.

Observability is restricted to bounded safe fields: operation class, result
code, duration bucket, canonical byte count, record count, page count, retry
class, tenant hash, and provider ID. Raw values, checkpoint bodies, cursor
contents, authorization material, and unredacted database errors are forbidden.

### 31.29.11 Retention, archive, backup, compaction, and legal hold

The descriptor MUST state closed support levels and policies for retention,
archive, legal hold, backup/restore, and physical compaction.

Normative minimums:

- logical committed event sequences and hashes never change under physical
  compaction;
- checkpoints may be deleted without changing replayability;
- archive remains lossless and hash-verifiable before primary deletion;
- a legal hold blocks destructive retention/archive deletion and returns the
  exact legal-hold code;
- retained lineage ancestors cannot be deleted while a retained child requires
  them;
- backup identity includes provider/schema version, tenant scope, stream heads,
  checkpoint summaries, lease/fence state, operation-ledger continuity, and a
  content hash;
- restore into a nonempty target requires an explicit conflict-safe mode and
  never lowers a fence;
- encryption/key references are metadata, never raw secrets; and
- unsupported administrative capability fails with the unsupported-version or
  invalid-argument code declared by the operation, not silent success.

S01 validates the descriptor and executable reference behavior for governance
locks/holds. S02/S03 must add real archive, backup, restore, migration, and
retention drills before any production claim.

### 31.29.12 Schema discovery and migration locking

Providers MUST expose strongly consistent schema discovery with current schema
version, compatible reader/writer interval, migration state, and descriptor
hash. A writer outside the interval fails before data access.

Migration locking is a separate idempotent mutation protocol. One exclusive
lock binds operation ID, owner ID, source version, target version, epoch/fence,
provider clock acquisition/expiry, and descriptor hash. A second live lock is
`GE_CYCLE_STORE_MIGRATION_LOCKED`. Takeover after expiry strictly increments
its fence. Release requires the exact lock identity. No online writer may run
through an incompatible in-progress migration. Memory-model support proves the
state machine only; real transactional locking belongs to S02/S03.

### 31.29.13 Provider interfaces and reference-model separation

TypeScript and Python MUST expose equivalent public concepts but MUST NOT shell
out to each other or import generated results from the other runtime.

The online interface includes:

- `describe` / schema inspection;
- strongly consistent `readTail`;
- atomic `append`;
- snapshot `readEventPage`;
- `saveCheckpoint`, `loadCheckpoint`, `listCheckpoints`, and
  `deleteCheckpoint`;
- `acquireLease`, `renewLease`, `releaseLease`, `inspectLease`, and takeover;
- legal-hold/retention status inspection and bounded governance mutations; and
- migration lock acquire/inspect/release.

The deterministic reference models MAY expose test-only fake-clock advancement,
fault injection, committed-byte corruption, and state counters. Those hooks are
not part of the provider interface and MUST be named unsafe/test-only. They
exist so conformance can prove ambiguity recovery, expiry, and corruption
without sleeping or relying on undefined adapter behavior.

### 31.29.14 Shared 54-case conformance campaign

The initial case manifest MUST contain exactly 54 ordered unique cases:

- descriptor/version/limit cases: 6 (four behaviors, two attacks);
- append/tail/idempotency cases: 12 (five behaviors, seven attacks);
- event snapshot-pagination cases: 8 (four behaviors, four attacks);
- checkpoint cases: 8 (four behaviors, four attacks);
- lease/fence cases: 12 (five behaviors, seven attacks);
- tenant/authorization/error cases: 4 (two behaviors, two attacks); and
- governance/migration cases: 4 (two behaviors, two attacks).

Total expected polarity is 26 behaviors and 28 attacks.

The required scenario inventory includes at least:

- exact descriptor acceptance and unknown-field/version/limit refusal;
- empty-tail creation, multi-record atomic append, exact retry, CAS loss,
  expected-hash drift, broken batch chain, duplicate record identity,
  commit-then-throw retry, and changed-operation-ID reuse;
- multi-page exact traversal, append-during-pagination snapshot isolation,
  beyond-tail empty page, cursor tenant/stream/from/page-size/tamper refusal;
- checkpoint save/load/list order/delete, exact retry, stale-tail save,
  content-hash drift, immutable-ID conflict, and corrupt-load refusal;
- first acquire, renew, release/reacquire, expired takeover, exact retry,
  active-owner conflict, early takeover, stale renew/release/write, expired
  write, substituted holder, and fence overflow;
- same IDs isolated across tenants, denied existence lookup, exact safe error
  envelope, and injected unavailable/quota/corruption classification; and
- legal-hold protection, lossless-compaction declaration, migration-lock exact
  retry, and live-lock conflict/takeover fence behavior.

Each case MUST assert an exact outcome, error code or canonical result, mutation
delta, record/checkpoint/lease counts, tail/fence values, and payload-leak
sentinel absence. Attack cases are green only when the expected typed error and
zero unintended mutation both match.

### 31.29.15 Independent native reports and differential join

`tools/conformance/cycle_store_provider.mjs` and
`tools/conformance/python_cycle_store_provider_report.py` MUST independently:

- validate the closed case manifest;
- instantiate their native reference model and fake clock;
- construct canonical records and request hashes locally;
- run all 54 scenarios without calling the other runtime;
- normalize only explicitly provider-variable fields such as wall-clock
  duration, never semantic results;
- emit descriptor hash, case-list identity, category/polarity totals, ordered
  exact per-case results, final state counters, and leak-sentinel scan; and
- exit nonzero on an unknown scenario, generic expected error, count drift,
  mutation drift, or leaked sentinel.

`tools/conformance/run.mjs` MUST deep-compare the complete reports. Comparing
only totals or error codes is insufficient. Fixture validation MUST freeze
exact case IDs/order, category counts, 26/28/54 totals, allowed descriptor
fields, expected-code vocabulary, unique assertions, and canonical case-list
bytes/hash.

### 31.29.16 Unit, model, and hostile tests

Native tests MUST separately cover implementation details not encoded in the
portable campaign:

- caller mutation before/after awaits and returned-value mutation;
- two truly concurrent append promises with one CAS winner;
- an injected yield immediately before commit;
- operation-ledger atomicity with commit-then-throw;
- cursor state cleanup/expiry and bounded cursor count;
- fake-clock rollback refusal;
- checkpoint corruption fallback boundary;
- authorization hook invocation before existence lookup;
- error serialization with no `cause`, stack, payload, secret, or database
  string leakage;
- maximum exact bounds and one-above rejection;
- migration/lease fence monotonicity under repeated takeover;
- safe snapshot/export of reference state for debugging; and
- public export parity and sorted Python `__all__`.

At least one independent model test MUST derive expected tail, page ranges,
checkpoint order, and fence progression without calling the provider's helper
that computes those values.

### 31.29.17 Documentation and downstream adapter handoff

Documentation MUST explain:

- why provider CAS differs from controller event semantic validation;
- why exact expected hash accompanies expected sequence;
- why mutation idempotency precedes current-state validation;
- why snapshot cursors exclude later appends;
- why checkpoints are disposable;
- why event appends become fenced after lease ownership begins;
- why the memory provider cannot prove production durability;
- which descriptor fields SQLite may truthfully claim;
- which stronger fields require PostgreSQL/database enforcement;
- how protected payload carriers cross the provider boundary;
- how to implement typed error translation without leaking database errors;
- how an adapter runs the shared conformance kit; and
- the exact remaining S02/S03/S04/I01 blockers.

S02 may start only after the S01 descriptor, error taxonomy, reference reports,
and immutable evidence are pushed. S02 must implement the same interface rather
than introducing SQLite-specific semantics into the contract.

### 31.29.18 Verification, evidence, and commit sequence

S01 acceptance MUST run, in order:

1. schema meta-validation and independent valid/hostile descriptor samples;
2. focused TypeScript provider tests;
3. focused Python provider tests;
4. Python Ruff and Mypy;
5. TypeScript lint and type checking;
6. exact 54-case native reports and full structural differential comparison;
7. complete fixture validation and documentation-link check;
8. full TypeScript and Python test suites;
9. complete cross-language conformance including all pre-existing joins;
10. full workspace build;
11. release-map and evidence-closure audits;
12. npm package contents and packed-install gates, serialized around artifact
    writers;
13. a freshly rebuilt Python wheel/sdist whose required path audit includes the
    new provider module;
14. production dependency audit;
15. exact staged-path and dirty-worktree exclusion audit;
16. implementation commits using `reacher-z <mtrxcop@gmail.com>`, empty bodies,
    and no coauthor trailer;
17. a fresh detached worktree at the final implementation tip with locked
    dependency install, documented build/dev prerequisites, and a repeat of all
    material gates;
18. a retained evidence record with commit/tree/parent, descriptor/case/package
    hashes, exact counts, all failed-first repairs, agent limitations, and
    remaining non-claims;
19. a separate evidence commit; and
20. push, fetch, identity/body audit, and local/remote zero-divergence proof.

The next dispatch after S01 evidence is S02 SQLite, unless a newly discovered
provider-contract defect requires an append-only S01 remediation section.

## 31.30 D7-S02 single-host durable SQLite CycleStore adapter

This section is appended after the immutable S01 implementation and evidence
were pushed. It does not rewrite, reorder, narrow, or mark complete any prior
plan text. It turns the provider-neutral contract into the first real durable
adapter while preserving the explicit boundary that SQLite is a local,
single-host database and not a distributed ownership service.

### 31.30.1 Outcome and non-claims

S02 MUST deliver independently implemented TypeScript and Python SQLite
adapters that satisfy the exact S01 provider interface and the complete 54-case
provider campaign. The same database file MUST be readable, writable, audited,
backed up, and restored by either runtime without an inter-language shell-out.

The bounded outcome includes:

- durable event records, stream heads, operation ledger, checkpoints, leases,
  legal holds, migration lock, cursors, and schema metadata;
- atomic compare-and-swap under real SQLite transactions;
- process restart and operating-system process crash recovery;
- same-host multi-process stale-writer exclusion through database-serialized
  fence checks;
- online backup through the SQLite backup API rather than raw file copying;
- integrity, foreign-key, canonical-byte, hash-chain, head, ledger, checkpoint,
  lease, and migration-fence audits;
- migration from the immediately previous repository-defined alpha schema;
- native and cross-language concurrency/crash/backup evidence; and
- installable npm and Python artifacts with the adapter and migration bytes.

S02 MUST NOT claim:

- multi-host or network-filesystem fencing;
- PostgreSQL-equivalent availability, failover, row-level concurrency, or
  point-in-time recovery;
- transparent encryption at rest from stock SQLite;
- asynchronous nonblocking database I/O merely because the provider methods
  return promises or coroutines;
- legal deletion, compaction, or archival that has no implemented API;
- checkpoint authority;
- protection of raw event payloads that were not protected before storage;
- safe raw copying of a live WAL database;
- release readiness, D7 completion, or any Star/popularity result.

### 31.30.2 Package topology and runtime floors

The TypeScript adapter MUST live in a new leaf package:

`packages/sqlite` → `@graph-engineering/sqlite`

It may depend on the public roots of `@graph-engineering/runtime` and
`@graph-engineering/core`. It MUST NOT import another package's `src/`,
`dist/`, private symbol, or filesystem-relative internal path. Runtime already
depends on persistence, so placing the SQLite adapter in persistence and then
depending on runtime would create a dependency cycle. The new leaf package
keeps the existing core/runtime/persistence Node floor unchanged.

The SQLite package MUST declare Node `>=22.16.0` because its implementation
uses the built-in `node:sqlite` online backup API and the 22.16 transaction and
statement surface. It MUST use only APIs present at that floor even when the
development `@types/node` is newer. CI MUST include the real floor and the
current supported 22.x line. The package README and root support matrix MUST
call out the active-development status of `node:sqlite` on Node 22.

Python MUST use the standard-library `sqlite3` module and retain the project
floor of Python 3.11. It MUST have explicit compatibility tests for Python 3.11
legacy transaction control and Python 3.12+ `autocommit` behavior.

### 31.30.3 Exact owned paths and forbidden shared paths

Primary S02 owned paths are:

- `packages/sqlite/package.json`;
- `packages/sqlite/tsconfig.json`;
- `packages/sqlite/LICENSE`;
- `packages/sqlite/README.md`;
- `packages/sqlite/src/index.ts`;
- `packages/sqlite/src/sqlite-cycle-store.ts`;
- `packages/sqlite/src/sqlite-codec.ts` if a package-private database codec is
  still required after the shared adapter kit;
- `packages/sqlite/src/migrations.ts`;
- `packages/sqlite/src/backup.ts`;
- `packages/sqlite/src/integrity.ts`;
- `packages/sqlite/test/sqlite-cycle-store.test.ts`;
- `packages/sqlite/test/sqlite-concurrency.test.ts`;
- `packages/sqlite/test/sqlite-backup.test.ts`;
- `packages/sqlite/test/sqlite-migration.test.ts`;
- `packages/sqlite/test/helpers/**` for bounded child-process workers only;
- `python/src/graph_engineering/sqlite_cycle_store.py`;
- `python/tests/test_sqlite_cycle_store.py`;
- `python/tests/test_sqlite_concurrency.py`;
- `python/tests/test_sqlite_backup.py`;
- `python/tests/test_sqlite_migration.py`;
- `spec/migrations/sqlite/**`;
- `spec/conformance/sqlite-cycle-store.case.json`;
- `tools/conformance/sqlite_cycle_store.mjs`;
- `tools/conformance/python_sqlite_cycle_store_report.py`;
- `tools/conformance/sqlite_interop.mjs`;
- `tools/conformance/sqlite_crash_harness.mjs`;
- `docs/SQLITE.md`;
- package/root/Python README and changelog integration;
- fixture, package, artifact, and conformance runners only where required; and
- S02 daily/review evidence files.

S02 MUST NOT absorb, stage, rewrite, or claim unrelated D4, D9, D10, budget,
redaction, protected-value, capture, subgraph-edge, task-registry, security
plan, or progress-scanner work already present in the shared worktree.

### 31.30.4 Adapter authoring kit remediation

S01 intentionally exposed the provider interface and value constructors but
left request capture/parsing helpers private to the memory oracle. S02 MUST not
solve this by copying hundreds of lines of subtly divergent validation into
each database adapter.

Add a bounded adapter-authoring kit in both languages. It MUST:

- capture every request before the first await;
- enforce closed objects, exact identifiers, hashes, integer bounds,
  timestamps, portable JSON, and descriptor-specific limits;
- return detached canonical typed requests;
- validate stored records and checkpoints by recomputing their canonical
  identities;
- compute the exact domain-separated operation request hash;
- create descriptors from a closed stronger-capability profile;
- parse stored canonical results without accepting unknown fields;
- expose no database-specific state or mutable parser internals; and
- be exercised by the memory provider itself or exact parity tests so it cannot
  silently drift from the oracle.

Prefer one frozen `cycleStoreAdapterCodec`/`cycle_store_adapter_codec` public
surface over many unrelated low-level exports. Public API additions MUST be
documented and package-tested. Private source imports are forbidden.

### 31.30.5 Truthful SQLite descriptor

Both adapters MUST independently produce the same descriptor bytes and hash
for provider ID `sqlite-local`. The initial profile MUST declare:

- schema version and compatibility interval: 1 only;
- durability: `durable`, but only after crash/restart evidence passes;
- distributed fencing: `false`;
- snapshot pagination and checkpoint CRUD: true;
- legal hold: `enforced` for persisted hold state and any implemented
  deletion boundary;
- backup/restore: `enforced` only after verified online backup/restore passes;
- compaction: `logical-history-preserving` with no physical compactor claim;
- payload protection: `external`;
- encryption at rest: `external`;
- retention and archival: `descriptor-only`;
- raw payload observability: false; and
- the exact safe observability field list from S01.

The descriptor MUST state through docs, not an invented enum, that WAL and
SQLite file locks require all writers to use the same local filesystem. A
database client on a file share MUST not be presented as distributed fencing.

### 31.30.6 Canonical migration inventory

Migration bytes MUST be reviewed repository artifacts, never assembled from
caller data. Define:

- a previous-alpha fixture representing schema version 0;
- the authoritative migration to version 1;
- a migration manifest containing version, previous version, SQL SHA-256,
  schema identity, reversibility classification, and required postconditions;
- byte-identical copies in the npm and Python artifacts; and
- validators that compare every packaged copy with the canonical spec bytes.

Migrations MUST run under an exclusive fenced migration decision. Unknown
future versions, missing intermediate versions, changed applied-migration
hashes, partial DDL, or a live incompatible migration MUST fail closed. A
failed migration MUST leave both schema and `user_version` unchanged.

Development downgrade guidance may rebuild a new database from a verified
backup. S02 MUST not claim an in-place destructive downgrade where no lossless
inverse exists.

### 31.30.7 Version-1 relational schema

Use `STRICT` tables and explicit indexes where supported by the declared
SQLite floor. The logical inventory MUST include:

1. `ge_cycle_schema`
   - singleton schema identity;
   - current version and compatible reader/writer interval;
   - applied migration hash and timestamp;
   - provider descriptor hash;
   - no caller-controlled SQL.
2. `ge_cycle_streams`
   - primary key `(tenant_id, stream_id)`;
   - exact tail sequence and record hash;
   - creation/update provider timestamps;
   - checks for missing versus nonempty-tail consistency.
3. `ge_cycle_records`
   - primary key `(tenant_id, stream_id, sequence)`;
   - tenant-wide unique `(tenant_id, record_id)`;
   - tenant-wide unique record hash where the schema contract requires it;
   - previous hash, value hash, value byte count, authoritative canonical BLOB,
     complete authoritative record BLOB, and commit timestamp;
   - foreign key to stream identity;
   - constraints on sequence, byte count, and hash text length.
4. `ge_cycle_operations`
   - primary key `(tenant_id, operation_id)`;
   - exact operation name and request hash;
   - canonical result BLOB, result hash, and commit timestamp;
   - written in the same transaction as the mutation.
5. `ge_cycle_checkpoints`
   - primary key `(tenant_id, checkpoint_scope, checkpoint_id)`;
   - bound stream, sequence, and record hash;
   - canonical checkpoint BLOB and summary fields;
   - content hash/byte count and deterministic ordering columns.
6. `ge_cycle_leases`
   - primary key `(tenant_id, stream_id)`;
   - optional active lease identity;
   - persisted last epoch and last fencing token even after release;
   - provider-millisecond acquisition and expiry values;
   - checks that active fields are jointly null or jointly populated.
7. `ge_cycle_legal_holds`
   - primary key `(tenant_id, stream_id, hold_id)`;
   - foreign key to an existing stream;
   - provider timestamp.
8. `ge_cycle_migration_lock`
   - singleton active lock plus last epoch/fence;
   - source/target versions, owner/lock identity, and provider times;
   - preserved last fence after release.
9. `ge_cycle_cursors`
   - opaque random token hash, never an authorization-bearing plaintext token;
   - kind, tenant and authorization binding, request scope, snapshot bounds,
     page position, descriptor/schema identity, snapshot BLOB, and expiry;
   - single-use transactional consume semantics.

Authoritative canonical carriers MUST be BLOBs. TEXT is permitted only for
safe identifiers, hashes, fixed enums, and timestamps/diagnostics. Neither
runtime may rely on `text_factory`, locale collation, implicit number
conversion, `SELECT *`, duplicate aliases, or property enumeration order.

### 31.30.8 Connection initialization and invariant checks

Every connection MUST explicitly establish and read back:

- `PRAGMA foreign_keys = ON` outside a transaction;
- `PRAGMA journal_mode = WAL` for writable file-backed databases;
- bounded `busy_timeout`;
- documented `synchronous` level, defaulting to `FULL` for the durability
  claim unless a weaker caller-selected mode changes the descriptor/nonclaim;
- trusted schema behavior appropriate to the supported SQLite version;
- extension loading disabled;
- double-quoted string literals disabled in Node;
- no writable-schema mode;
- a bounded WAL autocheckpoint policy; and
- the expected `application_id`, `user_version`, and schema manifest.

If a required setting cannot be applied or read back exactly, construction
fails before serving operations. Foreign-key enforcement MUST never be toggled
inside a transaction, where SQLite may silently ignore the request.

### 31.30.9 Transaction discipline

All mutations MUST execute as one complete synchronous database transaction:

1. no transaction is active;
2. `BEGIN IMMEDIATE` acquires the writer reservation;
3. exact operation ledger lookup occurs first;
4. current migration lock is checked;
5. current tail/lease/fence/governance state is read;
6. mutation-specific CAS and validation run;
7. authoritative rows and operation result are written;
8. fault boundary `before-commit` fires;
9. SQL `COMMIT` completes;
10. fault boundary `after-commit-before-return` fires; and
11. the detached canonical result returns.

Any exception while a transaction remains active MUST attempt explicit SQL
`ROLLBACK` in a `finally` path. SQLite does not automatically roll back the
earlier successful statements when a later statement fails. Nested public
transactions are forbidden.

Do not use a deferred read transaction and then upgrade it to a writer. Under
WAL, that path can fail immediately with `SQLITE_BUSY_SNAPSHOT` even when the
busy timeout is nonzero. Every mutation begins with `BEGIN IMMEDIATE` before
reading its decision state.

Python 3.12+ MUST use one documented transaction mode. If construction uses
`autocommit=True` plus manual SQL `BEGIN IMMEDIATE`, `Connection.commit()` and
`rollback()` MUST NOT be used because they can be no-ops for the manual
transaction. Use SQL `COMMIT` and `ROLLBACK` uniformly on every Python version.

### 31.30.10 Bounded busy retry and cancellation

Connection busy timeout is necessary but insufficient. Add a bounded whole-
transaction retry policy with explicit maximum attempts and elapsed-time cap.
Only SQLite BUSY/LOCKED base codes may retry. CAS loss, constraints, malformed
requests, corruption, permission, full disk, read-only media, and unsupported
schema MUST not enter the busy retry loop.

Each retry MUST restart from ledger lookup under a new `BEGIN IMMEDIATE`.
Never resume halfway through a failed transaction. Final lock exhaustion maps
to typed `GE_CYCLE_STORE_UNAVAILABLE` with safe bounded retry details and no
raw SQLite string.

Python `asyncio.to_thread` cancellation does not stop a running SQLite call.
The thread may commit after the awaiting task is cancelled. Documentation and
tests MUST require retry with the same operation ID, making cancellation an
ambiguous-outcome recovery rather than proof of rollback.

Node's `DatabaseSync` is synchronous and may block the event loop for the
configured timeout. The package MUST publish this limitation, cap busy time,
measure event-loop delay in tests, and avoid an unsupported nonblocking claim.

### 31.30.11 Atomic append and SQL CAS

Append MUST validate and capture the complete batch before opening a write
transaction. Inside the transaction:

- replay the exact operation ledger first;
- read the current stream head under the writer reservation;
- compare both expected sequence and expected hash;
- verify current active lease/fence when the stream has entered leased
  ownership;
- verify every sequence, previous hash, record hash, value hash, byte count,
  tenant-wide record ID, and batch-local uniqueness;
- insert every record;
- update or create the stream head with an exact conditional decision; and
- insert the operation result before commit.

One bad record MUST roll back the complete batch. `changes`/`rowcount`, not
`lastInsertRowid`, determines conditional-update success. A zero-row head CAS
is `GE_CYCLE_STORE_CONFLICT`. A constraint must be translated according to the
known statement and invariant, never by exposing or string-matching the raw SQL
message.

### 31.30.12 Durable idempotency ledger

The `(tenant_id, operation_id)` ledger is global across mutation operation
types. It stores operation name, domain-separated request hash, canonical
result bytes, and result hash.

An exact retry MUST return the first result even after restart, lease expiry,
tail advance, checkpoint deletion, legal-hold change, migration start, backup,
or restore. Same ID with any changed byte or operation name returns
`GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT` without mutation.

The crash harness MUST prove:

- kill before commit leaves neither mutation nor ledger;
- kill after commit but before acknowledgement retains both;
- retry after either outcome converges without duplicates; and
- no state exists where only the ledger or only the mutation committed.

### 31.30.13 Snapshot event and checkpoint pagination

Event pagination MUST bind the exact snapshot tail. Initial page creation and
cursor persistence occur transactionally. Later appends are excluded by the
stored tail sequence/hash. Continuations transactionally consume the old
cursor and create at most one successor.

Checkpoint pagination MUST persist the exact ordered summary snapshot, not
rerun a live query on each page. A save/delete between pages cannot introduce
a skip or duplicate. Ordering remains descending bound sequence, descending
created-at text, then ascending checkpoint ID.

Cursors MUST survive adapter close/reopen and a verified backup/restore. They
remain bounded, expiring, single-use, tenant/auth/scope/page-size/descriptor/
schema bound, and payload-free. Expiry cleanup MUST be bounded per operation;
an attacker cannot force an unbounded full-table sweep.

### 31.30.14 Checkpoints remain disposable

Checkpoint save validates the current exact event tail and live lease/fence in
the same write transaction. Immutable ID conflicts, stale tail, changed
content, or malformed canonical bytes commit nothing. Load MUST recompute the
canonical checkpoint identity and map drift to `GE_CYCLE_STORE_CORRUPTION`.

Database foreign keys and integrity checks do not replace application-level
hash validation. S04 will implement controller fallback to full fold; S02 must
surface typed corruption and never silently reinterpret a bad checkpoint.

### 31.30.15 Lease and fence persistence

Lease acquire, renew, release, inspect, and takeover decisions MUST use
provider time read within the database decision boundary or an explicitly
test-only deterministic clock.

Persist last epoch and last fencing token after release and expiry. Every
successful new ownership interval increments both monotonically. Reject
overflow before state change. A stale owner that resumes after another process
takes over cannot append or save a checkpoint.

SQLite file locking serializes same-host decisions but does not justify
`distributedFencing: true`. Multi-process tests MUST use distinct connections
and operating-system processes, not only multiple async tasks sharing one
object.

### 31.30.16 Governance and migration fencing

Legal holds MUST persist across restart, interop, backup, and restore. Hold
placement requires an existing stream and exact operation idempotency.

The migration lock retains its last epoch/fence when inactive. It follows the
same acquire/takeover/release/expiry rules as S01. While an incompatible live
migration exists, online mutations fail after exact idempotency replay and
before state change.

Schema migration itself MUST verify the held lock identity and fencing token
before each version transition. A stale migrator cannot publish a new schema
version after takeover.

### 31.30.17 Provider time and monotonicity

Default provider milliseconds SHOULD be derived by SQLite inside the
transaction using a version-compatible UTC expression, not a caller-supplied
timestamp. The adapter MUST remember the last observed provider millisecond
where needed and fail closed on a backward observation rather than reviving an
expired lease.

Tests may inject a deterministic clock, but the descriptor and docs MUST make
that hook test-only. TS and Python fake clocks start at the same retained epoch
so portable reports match exactly.

### 31.30.18 Error translation and leak resistance

Node SQLite errors are not a stable public provider taxonomy. Guard-narrow an
unknown exception and inspect numeric `errcode` only when present. Base-code
classification uses `errcode & 0xff`; at minimum test BUSY/LOCKED, READONLY,
IOERR, CORRUPT, FULL, CANTOPEN, CONSTRAINT, and NOTADB. Do not depend on message
text, `expandedSQL`, table names, column names, paths, or bound values.

Python MUST inspect `sqlite_errorcode`/`sqlite_errorname` when available and
retain compatible guarded fallbacks for Python 3.11. Translation is based on
operation context plus numeric class, never raw message projection.

Required mappings include:

- exhausted BUSY/LOCKED → `GE_CYCLE_STORE_UNAVAILABLE`;
- full/quota condition → `GE_CYCLE_STORE_QUOTA_EXCEEDED`;
- corrupt/not-a-database/hash drift → `GE_CYCLE_STORE_CORRUPTION`;
- read-only/permission/open denial → safe permission or unavailable class per
  exact operation policy;
- known conditional/unique invariant → exact conflict class; and
- unknown internal database failure → `GE_CYCLE_STORE_INTERNAL`.

Serialized errors MUST not contain raw SQL, schema names, file paths,
authorization context, payload bytes, SQLite messages, exception causes,
stacks, or expanded statements.

### 31.30.19 Authorization, payload protection, and observability

Request capture and authorization occur before existence-revealing database
queries. Authorization hooks may await, but no transaction is held while they
do. Once authorized, the complete database decision contains no awaits except
the outer thread/operation boundary.

Tenant ID is part of every primary/unique key that can reveal or mutate tenant
state. Same stream, record, checkpoint, operation, lease, hold, or cursor IDs in
different tenants MUST remain independent.

Canonical values are stored exactly as submitted after provider validation.
The adapter does not inspect or redact application payloads. Metrics and logs
use only S01 safe fields, hashed tenant identity, fixed result classes, byte
counts, page counts, duration buckets, and retry class.

### 31.30.20 Lifecycle and connection ownership

Each adapter instance owns exactly one connection unless an explicit bounded
pool is later added. `close()` MUST be idempotent at the adapter level even
though underlying Node close calls are not. Operations after close fail with a
typed safe unavailable/internal lifecycle error.

Prepared statements MUST use placeholders for every caller value. Node bare
named parameters and unknown named parameters SHOULD be explicitly disabled
when the floor supports it; otherwise use prefixed exact bindings. Never log
`expandedSQL`. Never pass caller text to `exec`.

Trusted migration `exec` may contain multiple statements. Tests MUST guard the
Node trap where `prepare()` silently compiles only the first statement of a
multi-statement string.

Python connection creation/close and complete transactions run in the worker
thread strategy selected by the adapter. A connection with
`check_same_thread=False` is not thereby transaction-safe; a per-instance
async lock and one complete transaction function MUST prevent a second thread
from committing another thread's transaction.

### 31.30.21 Backup, restore, and publication

Never copy the live main `.db` file. In WAL mode it can silently omit committed
records still present only in `-wal`.

Backup MUST:

1. require a file-backed open source and a new unique temporary destination;
2. refuse a caller target that already exists or resolves to the source;
3. call the native SQLite online backup API;
4. bound page rate, progress calls, elapsed time, and cancellation behavior;
5. close and reopen the temporary backup;
6. run quick/integrity, foreign-key, schema-manifest, canonical-byte,
   hash-chain, stream-head, operation-ledger, checkpoint, lease, hold, cursor,
   and migration-fence audits;
7. compute a content SHA-256 and manifest over the completed closed file;
8. sync the file and containing directory where the platform supports it; and
9. atomically publish to the final destination only after every check passes.

Restore MUST target a new empty path, verify the backup manifest before open,
run the complete audit after open, and refuse schema/capability incompatibility.
It MUST never overwrite a live store in place. Operator rollback is pointer/
rename selection of a separately verified database, not mutation of the failed
source.

Checkpointing APIs MUST inspect returned status rows. A WAL checkpoint that
returns `busy: 1` is not successful merely because it did not throw.

### 31.30.22 Integrity audit levels

Expose bounded explicit audit modes:

- `quick`: schema identity, connection settings, quick check, foreign keys,
  and counts;
- `structural`: full SQLite integrity plus indexes and constraints;
- `semantic`: every authoritative canonical BLOB, value hash, record hash,
  previous-hash chain, stream head, checkpoint binding, ledger result hash,
  lease/hold/migration invariants, and cursor bounds.

`PRAGMA integrity_check` alone is insufficient: it does not detect foreign-key
violations and cannot detect a canonical payload whose application hash was
maliciously changed consistently at the storage page level. Every evidence
backup/restore drill MUST run semantic mode.

### 31.30.23 Immediately previous alpha migration

The repository-defined v0 fixture MUST contain representative:

- two tenants with colliding public IDs;
- a multi-record hash chain;
- one checkpoint;
- released and active lease histories;
- one legal hold;
- idempotency results;
- no future/unknown columns; and
- a retained fixture identity.

The v0→v1 migration MUST preserve every canonical value and public result,
reconstruct/verify stream heads and indexes, retain monotonic fences, add the
final cursor/schema/manifest structures, and be idempotent on reopen. A
malformed v0 fixture or changed migration hash fails without partial upgrade.

### 31.30.24 Shared 54-case provider conformance

Refactor the existing campaign around an explicit async provider factory and
test-harness capability rather than copying the 54 scenarios. The default
factory remains the memory oracle. SQLite factories create an isolated file
per scenario and close it in `finally`.

The harness contract may expose test-only:

- deterministic clock advance;
- before/after-commit fault injection;
- safe state counters derived from SQL;
- bounded corruption injection; and
- deterministic cleanup.

Production consumers MUST not need or accidentally receive unsafe test hooks
through the minimal provider interface.

Run and retain these complete reports:

- TypeScript memory;
- Python memory;
- TypeScript SQLite;
- Python SQLite.

Memory reports compare completely across languages. SQLite reports compare
completely across languages. A declared normalization may differ only for the
truthful descriptor profile and nonsemantic provider-variable timing/token
fields. Every ordered case result, code, operation, retryability, observation,
zero-mutation proof, final counter, probe identity, and leak scan remains
exact.

### 31.30.25 SQLite-specific 36-case campaign

Add exactly 36 ordered unique cases with 18 behaviors and 18 attacks:

- bootstrap/descriptor/connection settings: 5;
- restart and durable state: 6;
- concurrent writer and busy handling: 6;
- crash and idempotency recovery: 6;
- backup/restore/WAL publication: 5;
- migration and integrity audit: 5; and
- lifecycle/error/close behavior: 3.

The required inventory includes:

- fresh creation and exact descriptor;
- repeated open with byte-identical schema identity;
- unsupported future version refusal;
- settings readback refusal;
- restart retention of every state family;
- same-file TS→Python and Python→TS read/continue;
- two-process empty-tail append with one exact winner;
- same-operation concurrent retry with one mutation and two same results;
- changed request under one operation ID;
- busy timeout then bounded success and bounded exhaustion;
- deliberate deferred-upgrade `BUSY_SNAPSHOT` regression proof outside the
  production path;
- kill before commit;
- kill after commit before acknowledgement;
- atomic 64-record append and one-bad-record rollback;
- stale owner write after takeover in another process;
- live-WAL online backup containing uncheckpointed commits;
- concurrent writes during backup;
- target-exists/source-alias refusal;
- restored ledger/fence/cursor identities;
- v0→v1 migration success;
- migration failure rollback;
- SQLite structural corruption;
- application canonical/hash corruption;
- foreign-key corruption found separately from integrity check;
- WAL checkpoint busy-row handling;
- close/double-close/use-after-close; and
- safe classification of read-only/full/open failures.

Each attack asserts exact typed code, zero unintended semantic mutation,
transaction cleanup, and leak-sentinel absence. Each behavior asserts exact
row/counter/head/fence/schema/backup identities.

### 31.30.26 Process crash and concurrency harness

Use real `child_process`/`multiprocessing` workers with explicit JSON control
messages and timeouts. No shell interpolation of IDs, paths, or payloads.

Required barriers are:

- opened;
- transaction reserved;
- decision state read;
- records staged;
- ledger staged;
- before commit;
- commit returned;
- before acknowledgement; and
- closed.

The parent may terminate only the explicit child PID it created. Every case
uses a fresh `mkdtemp` directory and an explicit database path. Cleanup occurs
after artifact retention and never targets a repository, home directory, root,
or unresolved variable.

Concurrency evidence MUST include separate runtime processes racing the same
file. Async tasks alone do not prove SQLite file-lock behavior.

### 31.30.27 Cross-language file interoperability

Interop MUST prove both directions and mixed races:

1. TS creates records, checkpoint, lease history, hold, cursor, and ledger;
   Python opens and validates every byte.
2. Python creates the same families; TS opens and validates every byte.
3. TS starts a snapshot; Python appends; TS continuation excludes the append.
4. Python starts a checkpoint snapshot; TS mutates live checkpoints; Python
   continuation has no skip/duplicate.
5. TS and Python race the same empty tail; exactly one commits.
6. One runtime acquires/takes over a lease; the other's stale writer fails.
7. One runtime creates a backup; the other restores and continues.
8. Both compute identical descriptor, migration, schema, record, operation,
   backup-manifest, and semantic-audit identities.

### 31.30.28 Native unit and hostile tests

Both runtimes MUST separately test:

- caller mutation before/after authorization await;
- returned-row detachment;
- exact and one-above every bound;
- BLOB byte round-trip and invalid UTF-8/JSON refusal;
- safe-integer conversion, including Node `BigInt` reads before public number
  conversion;
- row alias/type validation without `SELECT *`;
- transaction-active cleanup after every injected statement failure;
- unique/FK/check/base-code error translation by statement context;
- busy timeout/retry count/elapsed cap;
- connection initialization setting drift;
- process restart and double open;
- cursor expiry cleanup bounds;
- monotonic lease/migration fence overflow;
- semantic audit of tampered records/checkpoints/ledger/heads;
- backup target collision and source aliasing;
- WAL checkpoint returned-busy handling;
- idempotent adapter close and use-after-close;
- authorization before existence lookup;
- no raw SQLite value in serialized errors or logs; and
- public exports, types, package assets, and sorted Python `__all__`.

### 31.30.29 Performance characterization without false thresholds

Add reproducible raw benchmarks for:

- single-record append;
- 64-record append;
- one/two/four local writer contention;
- tail read;
- 256-record page;
- checkpoint save/load;
- lease renew;
- 10K/100K record semantic audit;
- online backup; and
- restore verification.

Record Node/Python/SQLite versions, filesystem, journal/synchronous settings,
database/WAL sizes, transaction retries, p50/p95/p99, and raw samples. Initial
alpha CI uses generous regression guardrails only after stable baselines exist;
it MUST not claim production throughput from one developer machine.

Use `EXPLAIN QUERY PLAN` assertions for hot lookups and ensure expected indexes
serve tenant/stream tail, record range, operation ID, checkpoint order, lease,
hold, cursor, and migration queries.

### 31.30.30 Documentation and operator runbook

`docs/SQLITE.md` and package/Python READMEs MUST document:

- installation and runtime floors;
- local-file and single-host scope;
- event-loop/thread blocking characteristics;
- safe constructor and close patterns;
- WAL, synchronous, busy timeout, retries, and checkpoint policy;
- expected database sidecar files;
- prohibition on network filesystems and live raw copies;
- online backup, manifest, audit, restore-to-new-path, and rollback steps;
- schema inspection and migration-lock operation;
- crash/ambiguous-commit retry with the same operation ID;
- corruption response and S04 checkpoint fallback boundary;
- payload protection/encryption responsibilities;
- safe metrics and forbidden logs;
- Node `node:sqlite` stability status;
- Python transaction compatibility; and
- explicit remaining PostgreSQL, S04, scheduler integration, and release
  blockers.

Every command snippet MUST run in documentation tests or a retained smoke
script. Examples use temporary paths and contain no destructive wildcard.

### 31.30.31 Supply-chain and artifact requirements

The new npm package MUST:

- be public MIT, side-effect free, and version-aligned;
- contain compiled JS, declarations, maps as policy allows, README, LICENSE,
  and exact migration assets;
- exclude tests, raw TypeScript, logs, plans, fixtures not required at runtime,
  databases, WAL/SHM files, backups, and environment data;
- install from its tarball with runtime/core dependencies rewritten correctly;
- import and open a temporary database at Node 22.16 and current 22.x; and
- expose no accidental runtime internals.

Python wheel and sdist audits MUST require:

- `sqlite_cycle_store.py`;
- the exact migration/manifest assets;
- public imports;
- an isolated temporary-database open/append/restart/read smoke;
- no test database/WAL/SHM/backup leakage; and
- wheel/sdist byte inventories recorded in evidence.

### 31.30.32 Threat model and misuse tests

Test and document defenses against:

- SQL injection through IDs, paths, JSON, and migration inputs;
- path traversal and symlink target substitution for source/backup/restore;
- backup source=destination and target overwrite;
- authorization probing across tenants;
- operation-ID ledger poisoning;
- cursor theft/replay/substitution;
- stale lease owner resurrection;
- migration lock theft;
- malicious canonical BLOB size/depth/UTF-8/hash drift;
- corrupted or replaced database header;
- read-only/full-disk/IO failure;
- long-held reader causing WAL growth/checkpoint starvation;
- lock denial of service;
- cancellation after hidden commit;
- raw SQL/error/expanded statement leakage;
- untrusted PRAGMA or ATTACH execution; and
- extension loading.

No caller-controlled identifier may become a SQL identifier. No extension,
ATTACH path, writable schema, or arbitrary PRAGMA API is exposed.

### 31.30.33 Parallel execution lanes

Use maximum safe disjoint-path concurrency after this appended contract is
frozen:

- lane A: adapter kit and campaign factory refactor;
- lane B: TypeScript package, schema executor, and native tests;
- lane C: Python adapter and native tests;
- lane D: canonical migration/manifest and validator;
- lane E: crash/concurrency workers;
- lane F: backup/restore/integrity and interop;
- lane G: documentation, package audits, and benchmark harness;
- lane H: independent hostile review and immutable evidence.

Only one lane owns each file. Shared runner/schema decisions are frozen before
parallel writers start. Package and artifact writers run serially. If agents
are quota unavailable, the root executes the same lanes sequentially without
lowering acceptance.

### 31.30.34 Required verification order

S02 acceptance MUST run:

1. migration manifest/schema validator and byte-identity checks;
2. adapter-kit memory parity tests;
3. focused TS SQLite tests;
4. focused Python SQLite tests;
5. TS lint/typecheck/build and Python Ruff/Mypy;
6. shared 54-case reports for both SQLite adapters and complete differential
   comparison;
7. exact SQLite-specific 36-case campaign;
8. process restart, true multi-process races, and crash boundaries;
9. cross-language same-file interoperability;
10. online backup, semantic audit, restore, and continue-writing drill;
11. v0→v1 migration and failed-migration rollback drill;
12. fixture and documentation validation;
13. full workspace TS and Python suites;
14. complete retained cross-language conformance;
15. release-map and evidence-closure audits without claiming release weight;
16. workspace build;
17. npm package contents and packed-install, serialized;
18. fresh Python wheel/sdist and isolated installed-artifact smokes;
19. production dependency audit, secret scan, and exact diff check;
20. exact owned-path staging and unrelated-dirty-file exclusion audit;
21. implementation commit(s) with the required identity, empty body, and no
    coauthor trailer;
22. push/fetch/local-remote equality;
23. detached worktree at the immutable implementation tip;
24. locked dependency install including explicit Python `dev` extra;
25. repeat all material native/database/crash/backup/package gates at that
    exact tree;
26. retain commit/tree/parent, migration/schema/descriptor/campaign/source/
    package/backup hashes, counts, timings, failed-first repairs, agent limits,
    and nonclaims;
27. separate evidence commit and push; and
28. fetch plus zero-divergence proof.

### 31.30.35 Commit and recovery discipline

Prefer reviewable commits in this order:

1. adapter kit and migration contract;
2. native SQLite adapters and focused tests;
3. conformance/crash/backup/interop harnesses;
4. documentation and package audits;
5. any gate-driven repair; and
6. immutable S02 evidence.

Every effective commit uses `reacher-z <mtrxcop@gmail.com>` for author and
committer, an empty body, and no coauthor. Do not amend already pushed
evidence. A failed cold gate creates a new repair commit and a new candidate.

Recovery always uses explicit paths. Temporary databases are created under
`mkdtemp`; backup/restore never overwrites the source; repository or home
directories are never recursive-delete targets; and unrelated shared edits
remain untouched.

### 31.30.36 Exit criteria and next dependency

S02 is complete only when:

- both adapters satisfy all provider operations and exact descriptors;
- all 54 provider cases and 36 SQLite cases pass natively and differentially;
- restart, crash, concurrent writer, stale fence, migration, backup, restore,
  and corruption drills pass;
- the same file interoperates in both directions;
- installed npm/wheel/sdist artifacts repeat the critical smoke;
- the detached immutable candidate is green;
- evidence is pushed with zero remote divergence; and
- remaining nonclaims stay explicit.

After S02 evidence, S03 PostgreSQL and S04 checkpoint acceleration may proceed
in parallel where their paths are disjoint. S02 success does not authorize
distributed-fencing, checkpoint-authority, scheduler-integration, release, or
popularity claims.

## 31.31 D7-S02 SQLite Operation-Ledger Semantic Closure Remediation

This section is an append-only acceptance amendment to 31.30. It does not
replace, weaken, or rewrite any earlier requirement. Where the older text
describes schema version 1 as the final SQLite shape, this later, more specific
remediation requires a manifest-bound version-2 migration before D7-S02 may be
called complete. The existing v0-to-v1 migration evidence remains required and
becomes the first edge of the v0-to-v2 chain.

The normative architecture companion is:

- codex_plans/architecture/sqlite-operation-ledger-replay.md.

No implementation or migration edit begins from this subsection until the
current TypeScript/Python defect-closing lanes have handed off their files and
the canonical version-2 field/order decision is frozen.

### 31.31.1 Why this remediation is release-blocking

The existing durable ledger proves request-hash identity and canonical result
integrity, but not that the result is the one produced by the physical
mutation. A coherent replacement of result_blob and result_hash can remain
canonical while disagreeing with stream records, checkpoint state, lease
state, legal holds, or the migration lock.

The hostile audit retained concrete failures:

- a forged canonical append result plus its matching result hash passed
  semantic audit while the real stream tail was unchanged;
- an event cursor whose tail hash and canonical snapshot BLOB were changed
  together passed semantic audit despite no matching immutable record; and
- a current checkpoint row with checkpoint_revision changed from 1 to 2 passed
  semantic audit despite no revision 2 row.

The latter two are repaired in the general semantic-integrity lane, but they
remain regression gates beside operation replay because final-state
reconciliation must not inherit blind spots.

The operation-ledger repair is complete only when an audit can:

1. decode the exact stored request;
2. prove its row identity and request hash;
3. place it in a total commit order;
4. replay its deterministic state transition;
5. independently derive its expected result;
6. compare that result with the stored result bytes; and
7. compare the replayed final state with every authoritative physical table.

### 31.31.2 Decision: formal schema v2, never inferred legacy requests

Adopt the architecture decision exactly:

- keep the existing result_blob encoding unchanged;
- add canonical request_blob for all new operations;
- add one global contiguous commit_sequence for all new mutation types and
  tenants;
- add an immutable canonical baseline for upgraded legacy state;
- leave legacy request hashes opaque;
- replay only post-baseline requests; and
- reconcile the replay result with baseline-covered and post-baseline physical
  state.

Do not hide a storage envelope inside result_blob. That would overload a
shared public codec and still could not recover arbitrary legacy request
identifiers.

Do not reconstruct legacy requests from current state. Controlled inference
from the present v0 fixture is not a general migration algorithm. It cannot
uniquely recover delete-checkpoint, repeated legal-hold, lease renewal/release,
or release-migration-lock requests after later state changes.

Rigor takes precedence over avoiding a canonical schema change.

### 31.31.3 Exact delivery inventory

The remediation is expected to add or update, subject to final ownership
handoff:

- spec/migrations/sqlite/schema-v2.sql;
- spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql;
- spec/migrations/sqlite/schema-v2.identity.json;
- spec/migrations/sqlite/manifest.json;
- spec/migrations/sqlite/manifest.schema.json only if its closed version graph
  cannot represent the second edge;
- a frozen pre-replay-v1 fixture and expected report;
- retained v0-to-v2 and v1-to-v2 migration reports;
- a canonical operation-request vector fixture covering all nine mutations;
- a canonical baseline-entry vector fixture covering every entry kind;
- a fixed 96-case replay/hostile fixture defined below;
- TypeScript migration, runtime, replay, and integrity code;
- Python migration, runtime, replay, and integrity code;
- cross-language same-file replay workers;
- backup/restore and packed-artifact updates;
- docs/SQLITE.md and both package READMEs;
- benchmark/query-plan additions;
- CI/package scripts;
- immutable candidate evidence; and
- explicit nonclaims.

The canonical spec lane decides file names and exact schema order once. Both
runtime lanes consume that decision; neither creates a private variant.

### 31.31.4 Version-2 operation row contract

ge_cycle_operations retains the version-1 primary key and fields and adds:

- ledger_format_version;
- request_blob; and
- commit_sequence.

Two and only two row forms are valid:

1. Legacy form:
   - ledger_format_version = 1;
   - request_blob IS NULL;
   - commit_sequence IS NULL;
   - row exists in the sealed baseline legacy-operation inventory.
2. Replayable form:
   - ledger_format_version = 2;
   - request_blob is a bounded non-empty BLOB;
   - commit_sequence is a safe integer from 1 through MAX_SAFE_INTEGER;
   - request bytes and result bytes satisfy the closed codecs.

Add a unique partial index over format-2 commit_sequence and a bounded ordered
replay access path. Preserve the tenant/operation primary key so idempotency
lookup remains exact.

Every replayable row MUST satisfy:

- request_blob decodes under operation_name;
- re-encoding produces byte-identical request_blob;
- the domain-separated operation request hash equals request_hash;
- request.context.tenantId equals tenant_id;
- request.context.operationId equals operation_id;
- result_blob decodes under operation_name;
- re-encoding produces byte-identical result_blob;
- the canonical result hash equals result_hash;
- committed_at_ms is not before the prior sequence time or baseline time; and
- operation_name is one of the exact nine mutation operations.

The maximum request BLOB bound MUST be derived from the closed provider bounds
and include the largest legal 64-record append without allowing an unbounded
allocation.

### 31.31.5 Global sequence contract

Add one ge_cycle_operation_sequence singleton containing:

- singleton = 1;
- baseline_id;
- last_commit_sequence;
- baseline_captured_at_ms; and
- updated_at_ms.

Sequence allocation occurs after all mutation decisions succeed but before the
ledger insert, within the same BEGIN IMMEDIATE transaction:

1. ledger replay lookup;
2. decision reads;
3. physical mutation staging;
4. safe last_commit_sequence + 1 calculation;
5. exact singleton CAS;
6. ledger insert with that sequence;
7. ledger-staged barrier;
8. before-commit barrier;
9. COMMIT.

The invariants are:

- zero post-baseline rows means singleton last = 0;
- N post-baseline rows means count = min sequence = 1, max sequence = N, and
  distinct sequence count = N;
- singleton last = N;
- exact retry does not update the singleton;
- any rollback preserves the prior singleton;
- a kill before commit leaves neither the sequence, mutation, nor ledger;
- a kill after commit retains all three;
- same-millisecond commits remain ordered by sequence;
- cross-tenant commits use the same order; and
- overflow fails before any physical mutation becomes durable.

Sequence order is not lastInsertRowid, wall-clock order, operation-ID order, or
tenant-local order.

### 31.31.6 Canonical request storage

The shared adapter codec gains a storage-facing request byte operation without
changing public provider request shapes:

- encodeCanonicalMutationRequest(operation, canonicalRequest);
- decodeCanonicalMutationRequest(operation, bytes);
- operationRequestHash(operation, canonicalRequest).

The TypeScript and Python implementations MUST:

- reject invalid UTF-8;
- reject invalid or non-canonical JSON bytes;
- reject unknown, missing, or reordered semantic fields after canonical
  round-trip;
- reject floats and integers outside the shared safe range where the contract
  forbids them;
- enforce exact nesting, string, batch, and BLOB limits;
- preserve null versus missing distinctions;
- detach all caller-owned values before authorization await;
- store no bearer token or raw credential;
- produce byte-identical output for all nine operations; and
- return only safe typed corruption on stored-byte failure.

Incoming exact retry still compares the domain-separated request hash first.
Semantic audit independently decodes the stored request and recomputes it; it
does not trust the row hash merely because an incoming request matches it.

### 31.31.7 Baseline schema and chain

Add:

- ge_cycle_operation_baselines;
- ge_cycle_operation_baseline_entries; and
- the sequence singleton bound to the active baseline ID.

The baseline header contains:

- baseline ID and format version;
- source application/user versions;
- source schema identity;
- source lineage ID and migration hash;
- source descriptor hash;
- captured_at_ms;
- legacy operation count;
- entry count;
- first/final entry hashes;
- projection SHA-256; and
- canonical policy BLOB.

The normalized entry table contains:

- baseline ID;
- contiguous zero-based ordinal;
- fixed entry kind;
- canonical key BLOB;
- canonical state BLOB;
- previous entry hash; and
- current entry hash.

The fixed kind order is:

1. schema-envelope;
2. migration-lineage;
3. stream-head;
4. record-identity;
5. checkpoint-current;
6. checkpoint-revision;
7. lease-current;
8. used-lease-identity;
9. legal-hold;
10. migration-lock-current;
11. used-migration-lock-identity;
12. legacy-operation.

Entry ordering uses kind rank and canonical key bytes. Ordinals cannot gap.
Entry hashes use an explicit domain separator, baseline ID, ordinal, kind,
key, state, and previous hash. A fixed empty root represents zero entries.

No one-BLOB whole-database snapshot is allowed. Baseline creation and audit
stream bounded rows so a 100K-record store does not require a second full
in-memory copy.

### 31.31.8 Baseline projection content

The baseline seeds every state item required for future replay:

- stream head identities;
- every pre-baseline record ID, sequence, hashes, value byte count, and commit
  time without duplicating user payload bytes;
- current checkpoint summaries, value identities, checkpoint_revision, and
  commit time;
- all checkpoint revision rows;
- active/released lease rows and all used lease IDs;
- every legal hold;
- active/released migration-lock state and all used lock IDs; and
- exact legacy operation identities, hashes, times, and result-byte hashes.

Before entries are written, migration validates every source canonical BLOB,
record chain, head, checkpoint, revision, fence, hold, cursor, migration row,
and legacy result. Baseline is not a mechanism for blessing corrupt source
state.

Payload BLOBs remain in authoritative tables. Their hashes and identities
enter the projection and every semantic audit independently decodes the
physical BLOBs.

Cursors are excluded from operation replay because pagination reads create and
consume them without operation-ledger rows. They remain part of the separate
cursor semantic audit and backup/restore contract.

### 31.31.9 Migration chain and fixtures

Never rewrite the already reviewed schema-v1.sql or
0001-alpha-v0-to-v1.sql bytes. Add a second manifest-bound edge.

Required migration inputs:

- existing canonical v0 fixture, unchanged;
- a new canonical pre-replay-v1 fixture;
- a fresh empty v1 database;
- a v1 database with no operations but every other state family;
- a v1 database with representative legacy operations for every mutation
  result shape;
- a v1 database containing ambiguous same-tenant, same-fence, multi-stream
  histories that prove request inference is not used; and
- malformed/future variants for rollback/refusal.

Required flows:

- fresh creation directly at v2;
- v0 to v1 to v2;
- v1 to v2;
- reopen v2 without migration;
- failed v0 first edge with zero partial state;
- failed v1 second edge with zero partial state;
- crash during baseline enumeration;
- crash after baseline entries but before version publication; and
- retry after every failure.

Preferred migration runs the full chain inside one exclusive transaction. If a
platform implementation must retain an intermediate v1 commit, v1 remains a
fully supported re-openable state and deterministic resume to v2 is proven.
No half-baseline is accepted.

### 31.31.10 Deterministic replay engine

The replay engine is deterministic plumbing, not a provider operation and not
a model node. It receives:

- validated baseline entries;
- format-2 rows ordered by commit_sequence;
- fixed descriptor limits;
- canonical codecs; and
- no ambient mutable context.

It MUST NOT:

- call authorization;
- read the current clock;
- use randomness;
- invoke a model;
- perform network/filesystem side effects;
- silently ignore an unsupported row; or
- substitute null for failure.

For each row it:

1. requires the exact next sequence;
2. validates request bytes, request hash, and row context;
3. validates result bytes and result hash;
4. requires nondecreasing committed_at_ms;
5. applies the operation-specific transition to shadow state;
6. derives the expected public result independently;
7. canonicalizes that result; and
8. compares expected and stored result BLOBs byte-for-byte.

Replay output includes only bounded counters and a semantic root unless a
test-only harness explicitly requests a safe projection.

### 31.31.11 append replay

For append, replay MUST:

- bind tenant, stream, operation ID, expected tail, lease, and records from
  request_blob;
- require reconstructed expected tail equality by existence, sequence, and
  hash;
- enforce lease/fence and expiry at committed_at_ms;
- validate a non-empty bounded batch;
- validate every record sequence, previous hash, record hash, value hash, and
  value byte count;
- enforce batch-local record-ID uniqueness;
- enforce tenant-wide uniqueness against baseline and replayed records;
- refuse sequence overflow;
- add immutable record identities to shadow state;
- update the shadow stream head;
- derive appendedRecords from the request length; and
- derive the exact result tail from the final record.

An earlier append remains verifiable after later appends because request_blob
retains the complete batch and commit_sequence preserves history.

### 31.31.12 checkpoint replay

save-checkpoint replay MUST:

- require exact bound record sequence/hash existence;
- enforce live lease/fence when applicable;
- validate canonical value identity;
- apply immutable checkpoint-ID behavior;
- allocate the next exact scope revision;
- retain a put revision;
- update current checkpoint state; and
- derive the exact summary result.

delete-checkpoint replay MUST:

- resolve exact scope/ID from request_blob;
- return deleted false only when the checkpoint was absent;
- require non-null matching expectedValueHash for a real delete;
- block deletion when any legal hold exists on its stream;
- allocate one delete revision only for a real delete;
- remove current state; and
- derive the exact deleted result.

Final reconciliation additionally requires each current
checkpoint_revision to name its exact retained put revision. A coherent
revision-number tamper must fail even when all canonical checkpoint BLOBs are
unchanged.

### 31.31.13 lease replay

acquire-lease replay MUST:

- require stream existence;
- compare expected fencing token;
- distinguish acquire from expired takeover at committed_at_ms;
- reject reused lease IDs;
- validate safe epoch/fence increment;
- validate safe expiry arithmetic;
- update current and used-ID shadow state; and
- derive the complete lease result.

renew-lease replay MUST:

- match active lease ID, holder, and fence;
- reject an expired binding;
- require strictly later safe expiry;
- preserve acquire identity/counters; and
- derive the exact renewed lease.

release-lease replay MUST:

- match the exact active binding;
- reject expired/stale release;
- clear active fields;
- retain last epoch/fence and used-ID history; and
- derive the exact released inspection.

Historical acquire/renew/release/takeover results remain verifiable even when
the final row is released or owned by a later lease.

### 31.31.14 legal-hold and migration replay

set-legal-hold replay MUST:

- require stream existence;
- apply idempotent place/release;
- preserve original placed time for an already present hold;
- keep the shadow hold set canonically sorted; and
- derive the exact governance inspection.

Two different histories ending in the same hold set remain distinguishable by
their request BLOBs and sequences.

acquire-migration-lock replay MUST:

- validate source and target versions;
- compare expected fence;
- distinguish acquire/takeover using expiry at committed_at_ms;
- prevent lock-ID reuse;
- use safe monotonic counters and expiry arithmetic;
- update current and used-ID shadow state; and
- derive the exact lock result.

release-migration-lock replay MUST bind the exact lock ID, owner, and fence,
clear only active fields, retain counters/history, and require the stored
result to be canonical null.

### 31.31.15 Physical final-state reconciliation

Replay success alone is insufficient. Semantic audit independently reads and
compares:

- every stream;
- every record identity plus canonical value_blob and record_blob;
- every current checkpoint, checkpoint_revision, checkpoint/value/summary
  BLOB, and revision row;
- every lease and used lease ID;
- every legal hold;
- migration-lock singleton and every used lock ID;
- every operation row and BLOB;
- baseline header and entries;
- sequence singleton; and
- schema/migration/catalog identities.

Comparison is bidirectional:

- a replayed row missing physically is corruption;
- a physical row missing from replay is corruption;
- a changed field is corruption;
- an extra row is corruption; and
- an order/count/root mismatch is corruption.

The audit digest includes the baseline root, operation sequence/root, and
reconciled state root with explicit domains. It never includes raw payloads in
its public report.

Event cursor audit MUST bind a non-empty snapshot tail to the exact immutable
record row for tenant/stream/sequence/hash. The synthetic empty-tail case must
obey the provider's durable stream semantics. Checkpoint cursor snapshots stay
historical snapshots and are validated canonically rather than compared with a
changed live checkpoint set.

### 31.31.16 Quick, structural, and semantic audit behavior

Retain the three audit levels but close their contracts:

- quick:
  - application/user/schema/descriptor identity;
  - explicit hardened connection setting readback;
  - quick_check;
  - foreign keys;
  - baseline/sequence/operation counts.
- structural:
  - everything in quick;
  - integrity_check;
  - exact catalog/index/constraint identity.
- semantic:
  - everything in structural;
  - every canonical authoritative BLOB;
  - baseline chain;
  - ordered operation replay;
  - final-state reconciliation;
  - cursor tail binding;
  - checkpoint revision binding;
  - fences, holds, migration, and clock watermark.

All levels are bounded and return structured safe failures. Backup and restore
evidence always runs semantic.

### 31.31.17 Cross-language wire parity

Retain exact canonical vectors for:

- each of nine mutation request BLOBs;
- each operation request hash;
- each of twelve baseline entry kinds;
- empty and non-empty baseline roots;
- each operation result BLOB/hash;
- commit-sequence projection;
- replay semantic digest; and
- safe failure JSON.

Required same-file flows include:

- TypeScript creates v2, Python audits and continues;
- Python creates v2, TypeScript audits and continues;
- TypeScript migrates v0/v1, Python verifies baseline bytes;
- Python migrates v0/v1, TypeScript verifies baseline bytes;
- alternating TS/Python writes across all nine mutations;
- same-file mixed-process append race with contiguous sequence;
- cross-runtime lease takeover and stale writer;
- cross-runtime checkpoint/hold/migration histories;
- backup in one runtime, restore/replay/continue in the other; and
- exact identity comparison after every handoff.

Normalization may differ only for explicitly nonsemantic runtime version
metadata. Request, baseline, operation, result, and semantic bytes never
normalize away.

### 31.31.18 Schema, hash, and artifact ripple

The version change requires deliberate updates to:

- migration manifest hash and manifest self-hash;
- schema SQL hash;
- schema identity document/hash;
- catalog hash;
- current schema version constants;
- provider descriptor schemaVersion and descriptor hash;
- cursor descriptor/schema bindings;
- backup manifest schema and semantic identities;
- migration-lock source/target validation;
- shared 54-case expected SQLite descriptor profile;
- exact-36 campaign manifest/descriptor identities;
- benchmark query plans for sequence-order replay;
- TypeScript migration asset imports/copies;
- Python importlib resource assets/copies;
- npm files inventory;
- wheel and sdist inventory;
- installed-artifact smokes;
- docs and changelog; and
- retained evidence.

All canonical assets remain byte-identical across spec, npm, wheel, and sdist.
No generated runtime copy may become the source of truth.

### 31.31.19 Nine-stage process barrier is a retained closed regression gate

The earlier hostile review correctly rejected one-way stage markers. The
current remediation evidence has since been strengthened and must be
preserved:

- the child emits each stage with a unique nonce;
- the child synchronously waits for a parent-created nonce ACK file;
- the parent success path acknowledges all nine stages;
- nine separate kill paths stop at each exact stage;
- every kill asserts the exact observed prefix and no result message;
- pre-commit kills retain zero records and zero ledger rows;
- post-commit kills retain one record and one ledger row;
- exact retry converges without a second mutation; and
- the decision-state-read barrier occurs after tail and lease decision state.

The stages remain exactly:

1. opened;
2. transaction reserved;
3. decision state read;
4. records staged;
5. ledger staged;
6. before commit;
7. commit returned;
8. before acknowledgement;
9. closed.

Current non-release evidence reports ten real processes passing in about 3.2
seconds. This is useful current evidence, not a substitute for repeating the
gate at the immutable candidate. The sequence remediation extends the same
assertions to sequence singleton state:

- stages 1 through 6 killed before successful COMMIT retain last sequence 0;
- stages 7 and 8 killed after COMMIT retain last sequence 1;
- closed success retains last sequence 1; and
- retry at every kill point leaves last sequence exactly 1.

### 31.31.20 Exact 96-case ledger replay campaign

Add one canonical fixture with exactly 96 ordered unique cases:

- 48 behavior cases;
- 48 attack cases;
- no skip, pending, expected-failure, platform waiver, or catch-all case;
- one fresh temporary root and explicit database path per destructive case;
- exact typed code/operation/retryability for every rejection;
- zero unintended mutation and exact transaction cleanup for every attack;
- leak-sentinel scan on every serialized report;
- TS-native and Python-native execution;
- exact cross-language comparison where specified; and
- a canonical report byte count and SHA-256.

The fixture IDs and minimum assertions are fixed below. Implementations may add
native tests outside the fixture but may not rename, merge, or silently weaken
these cases.

#### 31.31.20.1 Canonical request cases 01-16

1. OL-R01, behavior, ts-all-request-vectors:
   TypeScript encodes all nine canonical requests and matches exact fixture
   bytes and hashes.
2. OL-R02, behavior, python-all-request-vectors:
   Python produces byte-identical vectors and hashes.
3. OL-R03, behavior, decode-encode-roundtrip:
   both runtimes decode and re-encode every request exactly.
4. OL-R04, behavior, legal-boundary-request-sizes:
   exact maximum identifiers, values, and 64-record append remain accepted and
   bounded.
5. OL-R05, behavior, exact-retry-request-identity:
   close/reopen exact retry matches stored request/result and allocates no new
   sequence.
6. OL-R06, behavior, captured-before-authorization:
   hostile caller mutation before/after authorization await cannot change
   stored request bytes.
7. OL-R07, attack, invalid-request-utf8:
   malformed UTF-8 request_blob is corruption with no payload leak.
8. OL-R08, attack, noncanonical-request-json:
   valid JSON with noncanonical bytes/order/escaping fails byte round-trip.
9. OL-R09, attack, request-shape-drift:
   missing and unknown fields fail under the closed operation codec.
10. OL-R10, attack, request-number-domain:
    float, unsafe integer, negative bound, and forbidden numeric carrier fail.
11. OL-R11, attack, request-size-depth-exhaustion:
    one-above byte/depth/collection bounds fail without unbounded allocation.
12. OL-R12, attack, request-hash-only-drift:
    changed request_hash with unchanged BLOB fails.
13. OL-R13, attack, coherent-request-hash-row-mismatch:
    changed request BLOB/hash whose context differs from tenant/operation
    primary key fails.
14. OL-R14, attack, swapped-request-blobs:
    two same-operation rows cannot exchange request BLOB/hash pairs.
15. OL-R15, attack, operation-name-request-confusion:
    changing operation_name or decoding request bytes under another operation
    fails.
16. OL-R16, attack, request-error-leak:
    hostile byte content and leak sentinels never enter error JSON, logs, or
    report text.

#### 31.31.20.2 Sequence and atomicity cases 17-32

17. OL-R17, behavior, first-sequence-is-one:
    first new mutation stores sequence 1 and singleton last 1.
18. OL-R18, behavior, all-operation-global-order:
    every mutation type across tenants shares one exact contiguous order.
19. OL-R19, behavior, equal-timestamp-order:
    same-millisecond commits remain deterministic by sequence.
20. OL-R20, behavior, retry-does-not-advance:
    repeated exact retry before/after restart leaves count/max/singleton
    unchanged.
21. OL-R21, behavior, failed-decision-no-gap:
    conflict, stale fence, legal hold, and invalid request allocate nothing.
22. OL-R22, behavior, busy-retry-one-sequence:
    bounded whole-transaction BUSY retry eventually commits one sequence only.
23. OL-R23, behavior, mixed-process-contiguous:
    concurrent TS/Python writers produce unique contiguous sequences in actual
    commit order.
24. OL-R24, behavior, safe-last-sequence:
    MAX_SAFE_INTEGER minus one may commit MAX_SAFE_INTEGER exactly where the
    fixture safely stages the state.
25. OL-R25, attack, zero-sequence:
    a format-2 row with sequence zero is rejected.
26. OL-R26, attack, negative-sequence:
    negative sequence is rejected structurally or semantically.
27. OL-R27, attack, duplicate-sequence:
    duplicate global sequence cannot bypass unique/index/audit checks.
28. OL-R28, attack, sequence-gap:
    rows 1 and 3 without 2 fail contiguity.
29. OL-R29, attack, reordered-sequence-effects:
    swapping sequences on two valid rows fails replay preconditions/results.
30. OL-R30, attack, singleton-row-drift:
    singleton last lower or higher than count/max fails.
31. OL-R31, attack, sequence-overflow:
    allocation beyond MAX_SAFE_INTEGER returns quota exceeded before durable
    mutation.
32. OL-R32, attack, post-baseline-legacy-insertion:
    an extra format-1 row after the sealed baseline fails count/root/inventory.

#### 31.31.20.3 Baseline and migration cases 33-48

33. OL-R33, behavior, empty-v1-baseline:
    empty v1 upgrades with a deterministic empty/nonempty metadata baseline and
    sequence zero.
34. OL-R34, behavior, golden-v0-to-v2:
    unchanged v0 fixture traverses both edges and preserves every public value.
35. OL-R35, behavior, golden-v1-to-v2:
    representative v1 fixture produces exact baseline bytes/root.
36. OL-R36, behavior, large-streamed-baseline:
    100K record identities baseline and audit with bounded memory and batch
    reads.
37. OL-R37, behavior, no-legacy-operations:
    state families without legacy ledger rows still seed replay exactly.
38. OL-R38, behavior, all-legacy-result-shapes:
    baseline retains canonical legacy results for all nine operation names
    without request reconstruction claims.
39. OL-R39, behavior, ts-migrate-python-audit:
    TypeScript migration bytes/root are accepted exactly by Python.
40. OL-R40, behavior, python-migrate-ts-audit:
    Python migration bytes/root are accepted exactly by TypeScript.
41. OL-R41, attack, baseline-header-root-drift:
    changed final root or projection hash fails.
42. OL-R42, attack, baseline-entry-blob-drift:
    changed key/state BLOB with unchanged hash fails canonical/hash validation.
43. OL-R43, attack, baseline-order-drift:
    ordinal gap, reorder, or previous-hash break fails.
44. OL-R44, attack, baseline-entry-deletion:
    missing entry fails count/root and physical reconciliation.
45. OL-R45, attack, baseline-entry-insertion:
    duplicate or extra entry fails exact inventory.
46. OL-R46, attack, legacy-operation-drift:
    delete, insert, result change, operation-name change, or time change in a
    legacy row fails baseline binding.
47. OL-R47, attack, malformed-source-rollback:
    corrupt v0/v1 source refuses migration with original application/version/
    schema bytes intact.
48. OL-R48, attack, killed-baseline-publication:
    kill during enumeration or after entry staging leaves no accepted partial
    v2 and deterministic retry completes once.

#### 31.31.20.4 Operation replay cases 49-72

49. OL-R49, behavior, append-replay:
    request batch reconstructs records, head, count, and exact result.
50. OL-R50, behavior, historical-append-after-advance:
    an early append remains valid after later tail advances.
51. OL-R51, behavior, save-checkpoint-replay:
    exact checkpoint/revision/result state is reconstructed.
52. OL-R52, behavior, delete-present-and-absent:
    both deleted outcomes are derived from ordered state.
53. OL-R53, behavior, acquire-lease-replay:
    counters, used ID, expiry, and result reconcile.
54. OL-R54, behavior, renew-lease-replay:
    strictly extended expiry and stable identity reconcile.
55. OL-R55, behavior, release-lease-replay:
    released state/result and retained counters reconcile.
56. OL-R56, behavior, expired-takeover-replay:
    committed time establishes takeover eligibility and monotonic fence.
57. OL-R57, behavior, legal-hold-replay:
    idempotent place/release and sorted inspection reconcile.
58. OL-R58, behavior, migration-lock-replay:
    acquire/takeover/release and null result reconcile.
59. OL-R59, behavior, all-nine-alternating-history:
    one coherent history contains every mutation operation.
60. OL-R60, behavior, equal-final-hold-histories:
    distinct place/release sequences ending in the same set both replay
    correctly and remain distinguishable.
61. OL-R61, behavior, checkpoint-delete-recreate-history:
    allowed lifecycle transitions preserve exact revision chronology.
62. OL-R62, attack, historical-lease-result-forgery:
    coherently changed old acquire/renew/release result and hash fails replay
    even after later takeover.
63. OL-R63, attack, append-result-tail-forgery:
    changed append result/hash fails against request-derived tail.
64. OL-R64, attack, append-valid-other-tail:
    a hash naming another valid record/stream still fails.
65. OL-R65, attack, append-count-forgery:
    changed appendedRecords and matching result hash fails.
66. OL-R66, attack, checkpoint-result-forgery:
    another canonical checkpoint summary fails request/revision binding.
67. OL-R67, attack, delete-result-forgery:
    flipped deleted boolean plus result hash fails replay.
68. OL-R68, attack, lease-result-forgery:
    changed lease ID/holder/epoch/fence/time plus hash fails.
69. OL-R69, attack, governance-result-forgery:
    changed legal-hold inventory plus hash fails ordered shadow state.
70. OL-R70, attack, migration-result-forgery:
    forged lock fields or non-null release result fails.
71. OL-R71, attack, mutation-without-ledger:
    physical append/checkpoint/lease/hold/migration change absent from replay
    fails final-state reconciliation.
72. OL-R72, attack, ledger-without-mutation:
    otherwise canonical request/result row without its physical effect fails.

#### 31.31.20.5 Cross-language, backup, and artifact cases 73-84

73. OL-R73, behavior, ts-all-families-python-continue:
    TS creates all state families and ledger forms; Python audits every byte and
    continues.
74. OL-R74, behavior, python-all-families-ts-continue:
    reverse direction is exact.
75. OL-R75, behavior, ts-event-snapshot-python-append:
    Python append gains a sequence while the TS snapshot excludes it.
76. OL-R76, behavior, python-checkpoint-snapshot-ts-mutate:
    Python continuation has no skip/duplicate after TS live mutation.
77. OL-R77, behavior, mixed-empty-tail-race:
    separate TS/Python processes produce one append winner and one exact global
    sequence.
78. OL-R78, behavior, mixed-lease-takeover:
    one runtime takes over and the other's stale writer fails without sequence.
79. OL-R79, behavior, python-backup-ts-restore:
    restored baseline/requests/sequences audit and continued write uses N+1.
80. OL-R80, behavior, ts-backup-python-restore:
    reverse direction is exact.
81. OL-R81, behavior, all-identity-equivalence:
    descriptor, schema, migration, baseline, request, result, backup manifest,
    and semantic roots are identical.
82. OL-R82, behavior, alternating-runtime-all-operations:
    TS/Python alternate every sequence and both replay the same final model.
83. OL-R83, attack, cross-runtime-request-byte-drift:
    a request carrier accepted by only one runtime is a conformance failure;
    the retained fixture must reject it in both.
84. OL-R84, attack, old-artifact-new-schema-refusal:
    an artifact without v2 support refuses safely and cannot mutate a v2 file.

#### 31.31.20.6 Threat, lifecycle, and evidence cases 85-96

85. OL-R85, behavior, installed-npm-lifecycle:
    tarball install creates/migrates, appends, reopens, exact-retries, audits,
    backs up, restores, and continues.
86. OL-R86, behavior, installed-wheel-sdist-lifecycle:
    isolated wheel and sdist each repeat the complete critical smoke.
87. OL-R87, behavior, bounded-replay-characterization:
    10K/100K replay reports raw time/memory/query plans with no throughput
    claim.
88. OL-R88, attack, cancellation-hidden-commit:
    Python task cancellation may hide a committed sequence; exact operation-ID
    retry returns it and never allocates N+1.
89. OL-R89, attack, busy-full-io-failure:
    bounded BUSY, FULL, IOERR, and read-only failures retain sequence/state
    atomicity and safe numeric class.
90. OL-R90, attack, path-and-symlink-substitution:
    migration/backup/restore source and target path attacks cannot redirect or
    overwrite trusted state.
91. OL-R91, attack, sql-error-payload-leak:
    raw SQL, expanded statements, paths, request/result bytes, and sentinels do
    not escape.
92. OL-R92, attack, event-cursor-tail-forgery:
    coherent snapshot tail hash/BLOB change without matching record fails
    semantic audit.
93. OL-R93, attack, checkpoint-revision-forgery:
    current revision changed to a nonexistent or wrong retained revision fails.
94. OL-R94, attack, backup-baseline-manifest-forgery:
    changed baseline/sequence identity in backup or manifest blocks restore and
    removes unpublished target.
95. OL-R95, attack, migration-asset-byte-drift:
    one changed v2 SQL/identity/manifest byte fails before execution.
96. OL-R96, attack, evidence-and-nonclaim-sentinel:
    report/evidence validation rejects pending/skipped results, mutable refs,
    missing cold gates, release-ready language, distributed claims, or
    popularity claims.

### 31.31.21 Native unit tests outside the 96 cases

Both runtime suites also retain focused tests for:

- exact row aliases and SQLite carrier types without SELECT star;
- BigInt/safe-number conversion in Node;
- Python sqlite numeric extended/base-code mapping;
- canonical BLOB invalid UTF-8/JSON/depth handling;
- every prepared-statement failure point and transaction cleanup;
- connection setting readback refusal;
- busy attempt and elapsed-time hard bounds;
- sequence singleton CAS loss;
- baseline streaming batch bounds;
- returned-result detachment;
- caller mutation around authorization await;
- async fault-hook rejection before transaction await can escape;
- Python one-worker connection ownership;
- Python cancellation ambiguity;
- close/double-close/use-after-close;
- semantic audit after open and after live tamper;
- cursor cleanup bound;
- lease/migration timestamp and counter overflow;
- backup target/source identity and publication rollback;
- WAL returned-busy status;
- public exports and globally sorted Python __all__;
- package asset presence; and
- no raw SQLite value in errors/logs.

All nine operation transition functions receive direct deterministic unit
vectors in addition to end-to-end database tests.

### 31.31.22 Backup and restore remediation

Backup publication now treats these as one semantic identity set:

- schema v2 identity;
- migration lineage;
- baseline ID/root/count;
- operation count/sequence root;
- sequence singleton;
- reconciled state root;
- backup content hash; and
- manifest self-hash.

The source backup flow:

1. verifies no source/target alias;
2. takes one online SQLite backup;
3. opens the completed temporary copy read-only;
4. runs quick, structural, and semantic replay audit;
5. reads every required identity into a canonical manifest;
6. hashes/syncs the closed database and manifest;
7. publishes atomically; and
8. never reports success on a WAL busy status.

Restore:

1. requires a new absent path;
2. verifies manifest self-hash and database content before open;
3. validates schema/descriptor compatibility;
4. runs complete replay audit;
5. verifies baseline/sequence/semantic identities against manifest;
6. closes and syncs;
7. publishes only after all checks; and
8. removes temporary output on failure.

One runtime's backup MUST restore in the other and the next committed
operation MUST receive prior max sequence plus one.

### 31.31.23 Performance and boundedness

Extend raw SQLite characterization with:

- v1-to-v2 baseline migration at 10K and 100K records;
- v0-to-v2 representative migration;
- request encode/hash for one and 64 records;
- replay audit at 10K and 100K operations where practical;
- replay audit at 10K and 100K records;
- baseline entry streaming memory high-water;
- one/two/four process sequence allocation contention;
- semantic backup/restore with baseline;
- TypeScript event-loop blocking duration; and
- Python owner-worker/cancellation timing.

Record:

- Node, Python, and SQLite versions;
- CPU/filesystem/platform;
- WAL/synchronous/busy settings;
- source and destination sizes;
- baseline/operation/record counts;
- raw samples and p50/p95/p99;
- peak resident memory where portable;
- transaction attempts/exhaustions exposed safely;
- database/WAL/SHM sizes; and
- EXPLAIN QUERY PLAN details.

Expected indexed access paths include:

- operation primary-key replay lookup;
- commit_sequence ordered scan;
- sequence singleton;
- baseline ordinal chain scan;
- baseline legacy-operation identity;
- stream/record range;
- checkpoint order/revision;
- lease/used ID;
- legal hold;
- cursor;
- migration/used lock.

No benchmark is a release gate until a reviewed stable baseline exists. No
single-machine result becomes a production throughput claim.

### 31.31.24 Maximum-safe parallel implementation lanes

After the schema and wire decision is frozen, use disjoint ownership:

- lane OL-A, canonical protocol:
  - owns spec/migrations/sqlite, new fixtures, schemas, validators, and exact
    hashes;
  - freezes field order, baseline domains, and migration graph.
- lane OL-B, shared TypeScript codec:
  - owns packages/runtime request byte codec/types/tests;
  - does not edit SQLite migration assets.
- lane OL-C, TypeScript SQLite:
  - owns packages/sqlite runtime, replay, audit, migration executor, and native
    tests.
- lane OL-D, Python SQLite:
  - owns python/src/graph_engineering/sqlite_cycle_store.py, public exports,
    resources, and native tests.
- lane OL-E, interop/process:
  - owns tools/conformance replay fixture runner, workers, mixed-process races,
    and nine-stage regression.
- lane OL-F, backup/artifacts:
  - owns backup/restore gates, npm/wheel/sdist installed smokes, and inventory
    checks.
- lane OL-G, docs/bench:
  - owns docs/SQLITE.md, package READMEs, examples, docs smoke, benchmark, and
    query-plan assertions.
- lane OL-H, hostile acceptance:
  - read-only audits all lanes, reruns coherent tamper reproducers, and writes
    retained review evidence only after fixes land.
- root/integration:
  - owns package scripts, CI, lockfile, root docs, plan/log/evidence registry,
    staging, commits, push, and detached-candidate verification.

Only one lane edits each file. A lane needing another owner sends an explicit
handoff. Package and artifact builds run serially after source convergence.
No subagent stages, commits, or pushes unless root assigns that exact action.

### 31.31.25 Implementation decomposition

Execute these work packages in dependency order:

1. OL-00 freeze:
   - record current v0/v1 asset hashes;
   - freeze architecture decision;
   - assign file ownership;
   - capture existing red/green baseline.
2. OL-01 canonical model:
   - specify fields, constraints, domains, entry kinds/order, and exact
     canonical examples.
3. OL-02 migration graph:
   - add v2 schema and v1-to-v2 SQL/manifest/identity;
   - keep old migration bytes immutable.
4. OL-03 fixtures:
   - add pre-replay v1, v0-to-v2, v1-to-v2, request vectors, baseline vectors,
     and 96-case fixture.
5. OL-04 validators:
   - compile schemas;
   - validate hashes, catalogs, migration graph, entry chain, and reports.
6. OL-05 shared request codec:
   - implement TS canonical encode/decode/hash vectors;
   - align Python byte-for-byte.
7. OL-06 baseline builders:
   - implement bounded TS and Python enumerators;
   - differential-test every entry/root.
8. OL-07 migration execution:
   - atomic fresh/v0/v1 open paths;
   - rollback/crash/retry drills.
9. OL-08 sequence allocation:
   - update both mutation transactions;
   - exact replay/no-gap/overflow/concurrency tests.
10. OL-09 replay core:
    - implement deterministic shadow state and common row validation in both
      runtimes.
11. OL-10 operation transitions:
    - append;
    - checkpoint save/delete;
    - lease acquire/renew/release;
    - legal hold;
    - migration acquire/release.
12. OL-11 reconciliation:
    - all physical tables;
    - event cursor immutable-tail binding;
    - checkpoint current-revision binding.
13. OL-12 native hostile coverage:
    - run every coherent single/multi-field corruption in both runtimes.
14. OL-13 exact 96:
    - retain native reports and differential comparison.
15. OL-14 mixed runtime:
    - all-family handoffs, races, takeover, snapshots, alternating history.
16. OL-15 backup/restore:
    - identity set, cross-runtime restore, sequence continuation.
17. OL-16 artifact supply chain:
    - canonical assets, tarball/wheel/sdist inventory and installed lifecycle.
18. OL-17 docs/benchmark:
    - runbook, examples, limitations, raw bounded characterization.
19. OL-18 workspace integration:
    - package scripts, CI matrix, lockfile, root support table/changelog.
20. OL-19 hostile review:
    - independent source audit and retained failed-first reproducers.
21. OL-20 immutable candidate:
    - exact staging, commits, push/fetch equality, detached cold verification.
22. OL-21 evidence:
    - candidate hashes/counts/timings/nonclaims, separate evidence commit/push.

No later package starts before its required predecessor artifacts are frozen,
but independent runtime implementations and docs/hostile preparation run in
parallel after OL-04.

### 31.31.26 Required verification sequence

Run gates in this order, stopping on the first red result:

1. git diff --check on owned paths;
2. canonical migration/manifest/schema validators;
3. old asset immutability hash check;
4. request vector validation;
5. baseline vector/chain validation;
6. v0-to-v2 fixture migration;
7. v1-to-v2 fixture migration;
8. failed migration rollback cases;
9. TypeScript runtime unit/type/lint/build;
10. Python Ruff/Mypy/native unit suite;
11. TypeScript SQLite focused suite;
12. Python SQLite focused suite;
13. shared 54-case TypeScript SQLite;
14. shared 54-case Python SQLite;
15. exact full report comparison;
16. exact SQLite 36 campaign;
17. nine-stage success plus nine kill paths;
18. exact 96 replay campaign in TypeScript;
19. exact 96 replay campaign in Python;
20. exact 96 differential report comparison;
21. complete eight-scenario same-file interoperability;
22. mixed-process race/takeover/cancellation;
23. backup/restore/replay/continue both directions;
24. docs snippet smoke;
25. benchmark quick/query-plan gate;
26. full workspace TypeScript suite/build;
27. full Python suite;
28. production dependency and secret scan;
29. npm pack inventory and installed lifecycle;
30. wheel and sdist inventory and installed lifecycle;
31. exact diff/numstat/unrelated-dirty-file audit;
32. implementation commit(s) with required identity and no coauthor;
33. push/fetch/local-remote equality;
34. detached worktree at immutable candidate;
35. locked cold dependency install including Python dev extra;
36. repeat all material migration/native/96/interop/backup/artifact gates;
37. record immutable candidate evidence;
38. evidence-only commit and push;
39. final fetch/zero-divergence; and
40. independent exit-criteria audit.

Proposed stable command entry points:

- pnpm check:sqlite-migrations;
- pnpm test:sqlite-ledger-replay;
- pnpm test:sqlite-campaign;
- pnpm test:conformance;
- pnpm check:sqlite-artifacts;
- pnpm test:sqlite-docs;
- pnpm test:sqlite-benchmark;
- focused Python pytest paths for SQLite/replay/backup;
- Python Ruff and Mypy on every changed provider/test/tool file.

The exact package manager spelling may follow repository convention, but one
top-level command MUST make each material gate discoverable.

### 31.31.27 CI requirements

CI MUST include:

- Node 22.16 minimum and current supported 22.x for SQLite artifact open;
- supported Python floor/current matrix;
- canonical migration and hash checks;
- old migration-byte immutability;
- focused TS/Python replay tests;
- shared 54 and exact 36;
- exact 96 native/differential;
- nine-stage barriers;
- retained mixed-runtime interop;
- backup/restore;
- docs and quick benchmark/query plans;
- npm artifact lifecycle;
- wheel and sdist lifecycle; and
- full workspace gates.

Expensive 100K characterization may remain scheduled/manual raw evidence, but
bounded quick coverage and index assertions run on every candidate.

No CI job may pass by detecting a missing Node build and skipping cross-runtime
tests. Build prerequisites explicitly precede them.

### 31.31.28 Evidence record

Retain:

- candidate commit/tree/parent and remote ref;
- exact author/committer identity;
- old v0/v1 and new v2 schema/migration/manifest/catalog hashes;
- descriptor and backup schema identities;
- request vector fixture bytes/hash;
- baseline vector fixture bytes/hash;
- v0/v1 fixture bytes/hashes;
- exact-54, exact-36, exact-96 report bytes/hashes/counts;
- nine-stage success/kill process counts and timings;
- TS/Python interop identities;
- backup/restore manifest/content/semantic roots;
- npm/wheel/sdist names, sizes, inventories, and installed smoke results;
- benchmark environment/raw samples;
- test/lint/type/build command, exit code, count, duration;
- failed-first hostile reproductions and repair commit;
- unrelated dirty-file exclusions;
- detached worktree path and cold-install proof;
- push/fetch equality; and
- nonclaims.

Evidence contains no raw tenant payload, request BLOB, result BLOB, cursor
token, secret, environment value, or absolute private path.

### 31.31.29 Commit and push discipline

This planning task performs no commit or push.

When implementation is ready, root uses reviewable commits:

1. canonical v2 schema/migration/fixtures;
2. shared request codec;
3. TypeScript/Python runtime and replay;
4. conformance/interop/backup/artifacts;
5. docs/bench/CI;
6. gate-driven repair commits; and
7. evidence-only commit.

Every commit uses:

- author and committer: reacher-z <mtrxcop@gmail.com>;
- empty commit body;
- no Co-authored-by trailer;
- exact owned-path staging;
- no unrelated shared worktree changes; and
- no amend of already pushed evidence.

A red cold gate creates a new repair commit and a new immutable candidate.

### 31.31.30 Recovery and rollout

Before migration:

- take a verified online backup;
- retain source identity and manifest;
- stop incompatible old writers;
- verify local filesystem and available capacity; and
- run source semantic audit.

Migration failure leaves the old file unchanged or a complete supported
intermediate version. Never repair a partial baseline manually.

Rollback selects a separately verified pre-migration database by explicit
operator pointer/rename. It never mutates the failed live file in place.

An old runtime encountering v2 refuses unsupported version before mutation.
Mixed old/new writers are prohibited during rollout.

No recursive cleanup target may be a repository root, home directory,
unresolved variable, glob, or source database. Temporary roots use mkdtemp and
are deleted only after explicit path validation.

### 31.31.31 Required documentation

Update operator and package docs with:

- why result hash alone was insufficient;
- request_blob contents and privacy boundary;
- global commit sequence semantics;
- legacy baseline meaning and limitations;
- v0/v1-to-v2 upgrade and backup requirement;
- exact-retry behavior after cancellation/crash;
- semantic audit/replay commands and expected safe output;
- backup/restore and cross-runtime compatibility;
- old-runtime refusal;
- local-file/single-host limitation;
- Node event-loop and Python worker/cancellation behavior;
- payload encryption responsibility;
- corruption response;
- performance characterization nonclaims; and
- explicit remaining PostgreSQL/S04/scheduler/release blockers.

Every command snippet runs in retained docs smoke using temporary paths.

### 31.31.32 Explicit nonclaims

Completion does not claim:

- recovered request bytes for legacy operations;
- detection when an attacker coherently rewrites the database and every
  external trust anchor;
- distributed consensus or fencing;
- safety on network filesystems;
- protection from a compromised writer process;
- built-in encryption at rest;
- authoritative checkpoints;
- PostgreSQL parity;
- scheduler/controller integration;
- release readiness;
- production throughput;
- a security certification;
- 5K/6K stars; or
- guaranteed popularity.

Popularity remains an outcome influenced by adoption, documentation,
community, integrations, maintenance, and time. It cannot be established by a
test fixture or plan.

### 31.31.33 Final exit criteria

This remediation is complete only when:

- schema v2 and its migration graph are canonical, reviewed, and
  byte-identical in every artifact;
- arbitrary legacy request reconstruction is absent;
- baseline creation is atomic, immutable, canonical, and bounded;
- every new operation stores exact canonical request bytes;
- global commit sequences are contiguous and atomic across all mutation types
  and tenants;
- deterministic replay derives every stored result;
- replay and physical state reconcile bidirectionally;
- coherent ledger, cursor-tail, and checkpoint-revision forgeries fail in both
  runtimes;
- shared 54, SQLite 36, replay 96, and nine-stage gates are green;
- all eight cross-language same-file scenarios are retained and green;
- backup/restore and installed npm/wheel/sdist smokes preserve replay
  identities;
- the complete workspace is green;
- an independently audited detached immutable candidate is green;
- implementation and evidence commits are pushed with zero divergence; and
- all nonclaims remain explicit.

Until every item is proven, D7-S02 may be described only as active
implementation/remediation work, never complete or release-ready.

## 31.32 D7-S02 schema-v2 protocol-freeze execution checkpoint and next-build queue

This section was appended on 2026-07-27. It does not replace, weaken, edit, or
mark complete any preceding requirement. Section 31.31 remains the controlling
exit contract. This checkpoint records a reviewable foundation and the exact
remaining dependency order so implementation can continue without TypeScript
and Python inventing incompatible baseline bytes.

### 31.32.1 Effective foundation now implemented

The canonical lane now contains a schema-v2 protocol foundation with these
concrete properties:

- schema-v1.sql, schema-v1.identity.json, and 0001-alpha-v0-to-v1.sql retain
  their exact predecessor SHA-256 values;
- schema-v2.sql defines 16 strict canonical tables and 18 explicit indexes;
- ge_cycle_operations has two disjoint legacy/replayable forms, a bounded
  canonical request carrier, and global replay sequence access paths;
- ge_cycle_operation_baselines, ge_cycle_operation_baseline_entries, and
  ge_cycle_operation_sequence have closed carriers, safe-integer limits,
  immutable identity structure, and deferred in-transaction ownership links;
- 0002-v1-to-v2-operation-replay.sql rebuilds the version-constrained schema
  singleton and operation table without guessing legacy request bytes;
- fresh-v2, v1-to-v2, and v0-to-v1-to-v2 executions produce the same explicit
  normalized SQLite catalog signature;
- a frozen empty-but-published v1 source fixture exercises the second edge;
- schema-v2.identity.json freezes table field order, index inventory, BLOB
  inventory, and global/tenant ownership;
- sqlite-operation-ledger-v2.md freezes request bounds, hash domains, fixed
  roots, baseline ID, policy bytes, the twelve entry key/state shapes, legacy
  retry language, cursor rebinding, and publication behavior;
- manifest-v2.preview.json and its closed schema freeze the intended two-edge,
  two-fixture graph without switching the active runtime manifest early; and
- validate-v2-preview.mjs executes both migration edges, asserts catalog
  equivalence and rollback, validates every asset hash, and rejects drift in
  both immutable predecessors and new self-reporting assets.

The active manifest deliberately remains version 1 until the runtime lanes can
consume version 2 atomically. A manifest-only switch would make existing
TypeScript and Python packages reject their own assets and is therefore not a
valid progress shortcut. The preview is a frozen integration input, not a
runtime release claim.

### 31.32.2 Frozen v2 identities at this checkpoint

These identities are integration inputs. If a reviewed protocol correction
changes one, all dependent previews, tests, mirrors, and evidence MUST move in
one explicit repair commit rather than silently normalizing drift:

- schema-v2.sql SHA-256:
  5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5;
- schema-v2.identity.json document SHA-256:
  c6a2df3422eadf60a814c55f9c266dffde52e9da021cc554ea19a6785669cec2;
- schema-v2 logical identity SHA-256:
  9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634;
- 0002-v1-to-v2-operation-replay.sql SHA-256:
  1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d;
- pre-replay-v1-empty.sql SHA-256:
  89c616b843dd4b1967cb57e0e823edb3bb6c9dbfc6e0ff19874a6202415150b2;
- pre-replay-v1-empty.expected.json SHA-256:
  6f546e51fca95e7dd10c88def43839935152bc3a28b2691643811ee291d7bdea;
- pre-replay fixture identity:
  4861d354e55357a2a28490036fa0c45f347e6f9ffdc05150bd802e5ce64644d7;
- baseline genesis hash:
  5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96;
  and
- baseline empty root:
  66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a.

### 31.32.3 Immediate TypeScript implementation queue

Execute this queue in order while keeping the active manifest on v1 until the
atomic-switch item:

1. Add baseline protocol constants and closed key/state encoders in one new
   SQLite-owned module. Unit-test all twelve kinds before database writes.
2. Add exact vector fixtures containing canonical key bytes, state bytes,
   predecessor hashes, entry hashes, first/final roots, policy bytes, baseline
   ID, and projection SHA. Python consumes these vectors unchanged.
3. Implement a bounded source-v1 enumerator. Each query names columns, orders
   by the canonical key, and emits one entry at a time. It validates every
   authoritative BLOB before emitting an identity-only projection.
4. Split current validateV1 into a frozen source validator and a new v2
   validator. The v1 trust anchors remain compiled constants after the switch.
5. Add v2 assets to the checksum loader without removing the v1 identity and
   0001 anchors. Verify both ordered migration edges and both fixture domains.
6. Implement direct fresh-v2 bootstrap using the specified empty canonical v1
   source identity, final baseline, sequence zero, migration-lock singleton,
   and one version-2 fresh lineage row.
7. Implement v1-to-v2 inside one exclusive transaction: source semantic audit,
   0002 execution, streaming entries, final header, cursor identity rebind,
   sequence zero, lineage append, metadata publication, catalog/postcondition
   validation, and one commit.
8. Refactor v0 open so 0001 and 0002 execute under one managed upgrade session
   with no externally accepted half-baseline.
9. Change the SQLite provider descriptor to schema version 2 and retain the
   old descriptor hash only for validating/rebinding a v1 source.
10. Extend mutation replay lookup to validate row format, request bytes/hash,
    primary-key context, result bytes/hash, sequence, and time before deciding
    exact retry or idempotency conflict.
11. Add the sequence singleton exact CAS after mutation decisions. Overflow,
    CAS loss, BUSY rollback, and every pre-commit failure retain the old
    high-water and physical state.
12. Store format-2 request bytes and commit sequence for all nine mutation
    names. Exact retry never updates the singleton.
13. Add baseline/sequence/common-row semantic audits before operation-specific
    deterministic replay. Unknown format maps to unsupported version; invalid
    stored bytes map to corruption without carrier leakage.
14. Implement nine pure transition functions, then exact bidirectional
    physical reconciliation. No transition reads a clock, invokes
    authorization, or performs I/O.
15. Extend backup identity and restore publication with baseline root/count,
    request rows, sequence high-water, and replay/reconciliation digest.
16. Only after focused fresh/migration/mutation/audit/backup tests are green,
    replace the active manifest with the reviewed v2 preview, vendor all assets
    into the npm package, update release hashes, and rerun the previous v1 gate
    as an immutable regression.

### 31.32.4 Immediate Python implementation queue

Python starts from the same byte vectors and follows the same dependency
order. It MUST NOT translate names, choose a different baseline ID, omit nulls,
or normalize runtime evidence into semantic hashes.

1. Mirror public protocol constants and implement the twelve key/state encoders
   against the shared vector fixture.
2. Keep the owner-worker connection model; baseline iteration, 0002, cursor
   rebinding, header/sequence publication, and metadata finalization all run in
   the single exclusive owner task.
3. Preserve frozen v1 source constants alongside new v2 constants. Asset
   loading validates schema-v1, identity-v1, 0001, schema-v2, identity-v2, and
   0002 independently.
4. Implement fresh, v0, v1, v2, future, and foreign-application open branches
   with the same accepted lineage shapes as TypeScript.
5. Encode request bytes once outside the synchronous transaction block from
   the already detached request. Compare stored bytes on replay and allocate
   the sequence by exact singleton CAS only for a new successful mutation.
6. Preserve cancellation ambiguity semantics: a cancelled caller may have a
   hidden committed sequence, and exact operation-ID retry must recover that
   row without allocating the next sequence.
7. Implement the same nine deterministic shadow transitions and exact final
   reconciliation from the same vectors.
8. Extend backup/restore and public inspection counters only after the report
   schema is frozen in the canonical lane.
9. Run Ruff, Mypy, focused pytest, full pytest, and wheel/sdist installed
   lifecycles before parity is claimed.

### 31.32.5 Conformance and hostile queue

The current exact-96 file is a frozen activity contract, not proof that 96
runtime behaviors exist. Convert it into executable evidence without merging
cases:

- add twelve-kind baseline byte vectors before OL-R33 through OL-R48 execute;
- preserve 48 behavior and 48 attack cases with no pending/skip/xfail path;
- run each destructive case in a fresh validated temporary root;
- include exact typed error code, operation, retryability, transaction state,
  row counts, sequence high-water, and leak-sentinel result;
- alternate TypeScript and Python on one physical file for the specified
  cross-language cases;
- extend every nine-stage kill assertion with sequence singleton state;
- forge request/blob/hash/context combinations, baseline chains, coherent
  historical results, and unledgered physical rows independently; and
- compare native report canonical bytes and hashes, not only pass counts.

### 31.32.6 Verification checkpoint recorded now

The protocol-freeze gate currently proves:

- seven Node tests pass: four exact-96 contract tests and three executable v2
  preview tests;
- the exact-96 fixture remains 96 ordered cases, 48 behavior and 48 attack,
  with canonical case SHA
  0e6b481368c774ac870b593bd8f86af1b97d0bdc6ab0df23c82f1d88d4a30f38;
- the active v1 validator still passes fresh, migration, reopen, rollback, and
  five native tests;
- the preview validator executes both edges and reports 16 tables, 18
  explicit indexes, two migrations, and two fixtures; and
- git diff whitespace validation and immutable predecessor hashes are green.

This checkpoint does not prove runtime v2 persistence, deterministic replay,
the exact 96 implementation campaign, artifact parity, release readiness,
PostgreSQL parity, scheduler integration, production throughput, or any GitHub
star outcome. All §31.31 exit criteria remain open until their retained gates
pass.

## 31.33 Cross-language baseline byte implementation and production integration queue (append-only)

This section records the implementation that follows the §31.32 contract
freeze. It does not modify or weaken any earlier requirement. The protocol is
now implemented in both languages, but `implementationClaim` remains `false`
because provider migration, persistence, replay, reconciliation, artifact
parity, and the exact 96 runtime campaign are not complete.

### 31.33.1 Implemented and independently audited byte layer

The shared behavior fixture contains exactly twelve entries in frozen kind
rank, one legal source-v1 row for every baseline kind. Every vector retains its
canonical value, canonical UTF-8 text, exact hex, byte length, byte SHA-256,
ordinal, previous hash, and entry hash. The fixture also retains twelve hostile
mutations covering noncanonical bytes, unknown/missing fields, duplicate keys,
ordinal and predecessor drift, invalid UTF-8, entry/root drift, and projection
drift. Its current exact file SHA-256 is
`ae000ea64a6ab2bf8a0c9bcffaba36ea06d7f8b489021d4f4afdd7e3caea5610`.

The golden source originally exposed an invalid clock relationship during an
independent hostile review: the migration-lock clock high-water preceded the
last retained legacy operation commit. That fixture was rejected rather than
grandfathered. `migration-lock-current.updatedAtMs` is now
`1735689601000`; BL-V10 through BL-V12 and the projection were regenerated.
The retained final root is
`b9948b7fa96c6d45f0fac10a52792ce88a4e243741dccf1e364311aeaba7dc86`
and the projection hash is
`2a15f26152e5328917066f94df3f1911101cfca324045c3e9e012b8dc1d0f00a`.
The validator independently rejects a clock watermark below any represented
source observation, a capture before that watermark, and a source lineage ID
that differs from the migration row.

TypeScript and Python now share the following byte-layer behavior:

1. six domain-separated SHA-256 constants, genesis/empty roots, a closed
   policy object, bounded source envelope, and source-derived baseline ID;
2. all twelve closed key and state shapes with safe-integer, identifier, hash,
   byte-size, RFC3339 calendar, timestamp-order, predecessor, revision,
   lease, migration-lock, operation-name, and nullable-action constraints;
3. exact checkpoint summary/outer-state identity, including the direct
   TypeScript state encoder rather than only the aggregate builder;
4. kind-rank then unsigned canonical key-byte ordering, duplicate rejection,
   contiguous ordinals, predecessor chain, legacy count, first/final root, and
   projection identity;
5. fatal UTF-8 decoding, duplicate JSON-key rejection through canonical
   round-trip identity, byte bounds, and safe non-leaking failures; and
6. detached results: TypeScript returns cloned buffers on every access and
   Python decodes fresh key/state objects from immutable bytes, so a caller
   cannot mutate data after its hash has been published.

The independent hostile reviewer reproduced and then verified repairs for
four TS/Python acceptance-domain divergences: schema timestamp order,
migration continuity/postconditions/reversibility, record-zero predecessor,
and migration-lock source/target direction. The reviewer also verified the
calendar-date repair, direct checkpoint-summary enforcement, result mutation
isolation, corrected clock fixture, hashes, sorting, duplicate behavior, and
empty root. No HIGH or MEDIUM byte-protocol finding remains at this checkpoint.

### 31.33.2 Required streaming accumulator before provider integration

The current convenience builders intentionally materialize and sort a complete
input. They are suitable for small fixtures and differential tests only. They
MUST NOT be used as the production 10K/100K migration path. Before provider
integration, both runtimes must add a constant-retained-memory accumulator
that receives already canonical-order entries and requires an exact expected
entry count.

The TypeScript API must provide an `OperationBaselineAccumulator` whose
constructor accepts a validated baseline ID and safe nonnegative expected
count; `append` validates and detaches one input, enforces monotonic kind/key
order, rejects duplicates and count overflow without advancing state, derives
one immutable canonical entry, and retains only the previous rank/key and hash
summary; `finish` rejects truncation, computes the exact existing projection,
seals the object, and is idempotent. The Python `BaselineAccumulator` must have
the same state machine and return immutable dataclasses and bytes.

Accumulator acceptance requires, in both languages:

- the shared twelve-kind fixture streamed one entry at a time with exact bytes,
  ordinals, predecessors, roots, counts, and projection;
- empty expected-count zero behavior with the frozen empty root;
- kind regression, same-kind byte regression, duplicate, and numeric lexical
  ordering attacks, including revision order `1,10,2` rather than `1,2,10`;
- constructor negative/unsafe counts, append overflow, finish underflow,
  append-after-finish, and idempotent finish;
- failure atomicity proving every rejected append leaves count, tail, and
  subsequent accepted hash identical to a clean accumulator;
- source and return-value mutation attacks; and
- a 100K streamed scheduled gate that does not first construct a 100K array or
  tuple, reports actual count/root, and retains no pending or skipped outcome.

### 31.33.3 Atomic runtime implementation order

After the streaming accumulator is green, implementation proceeds in the
following dependency order. Each item is incomplete until both native
runtimes and cross-language file handoff pass.

1. Add database-facing baseline-store modules instead of expanding the
   migration monoliths. Split same-connection source-v1 semantic audit from
   path-opening public audit so the migration never deadlocks its own exclusive
   lock.
2. Add named-column source iterators for all twelve families. Queries execute
   in frozen kind order and canonical key-byte order. Numeric JSON keys require
   lexical canonical-number ordering; the accumulator remains the final
   authority and rejects any query-order drift.
3. Count all source families inside the same exclusive transaction and pass
   the exact total to the accumulator. Every appended entry is inserted
   immediately and released. Header and sequence singleton are published only
   after `finish` succeeds.
4. Implement fresh-v2 bootstrap from the specified hypothetical empty v1
   identity; implement v1→v2 capture; and refactor v0 so 0001 and 0002 share
   one exclusive transaction. No externally visible committed v1 midpoint is
   allowed.
5. Rebind retained cursor descriptor/schema hashes only after their full v1
   authorization, scope, snapshot, tail, and time audit. Preserve every other
   cursor byte and row identity.
6. Publish v2 lineage, schema identity, descriptor, and user version only
   after baseline header/entries and sequence zero exist. Run catalog,
   foreign-key, integrity, baseline, cursor, and physical reconciliation gates
   before the one commit.
7. Integrate exact stored request bytes and one sequence CAS into all nine
   mutations. Retry reads and validates retained evidence but allocates no
   sequence. New success advances exactly once; overflow/CAS loss/BUSY/error
   rolls back physical state, ledger row, and high-water together.
8. Add pure deterministic replay transitions seeded from the validated
   baseline, then bidirectional physical reconciliation. Cursor validation is
   independent but included in the final audit report.
9. Extend backup/restore identity with baseline root/count, legacy count,
   sequence high-water, and replay digest. Restore must replay and reconcile
   before atomic publication, then prove the next write is N+1.
10. Switch the active manifest and v2 descriptor only after both installed
    npm and wheel/sdist artifacts contain and validate all six immutable
    schema/migration assets and every native/cross-language gate passes.

### 31.33.4 Mandatory crash and scale evidence

Failure injection must cover exclusive reservation, source audit, post-0001,
post-0002, first/middle/last baseline entry, header, sequence, cursor rebind,
lineage, metadata publication, postconditions, pre-commit, and commit-returned.
Every pre-commit throw or process kill must reopen as the exact old logical
image with no v2 partials. A kill after commit-returned must reopen as one
complete v2 image. In-process hooks are not sufficient; retained subprocess
SIGKILL evidence is required.

The quick accumulator/migration benchmark uses bounded generators at 128 and
1,024 entries. Scheduled evidence uses 10K and exact 100K, records warmups and
raw samples plus p50/p95/p99, database/WAL/SHM sizes, source/baseline counts,
fetch batch, transaction attempts, query plans, and peak RSS. It must say
`releaseGate:false` and `productionThroughputClaim:false` until reviewed
thresholds and stable runners exist. Structural bounded-fetch, exact-count,
contiguous-chain, and root-parity assertions are gates immediately; RSS is
reported before it becomes a stable threshold.

### 31.33.5 Current verification boundary

At this checkpoint the shared fixture validator, TypeScript SQLite package,
Python focused suite, strict type checks, Ruff, MyPy, and whitespace checks are
green. The complete serial Python suite is rerun before the implementation
commit is published because a previous concurrent all-workspace run produced
one nonreproducible controller timing failure; the isolated case and all 62
controller cases passed immediately afterward.

This section records no runtime-v2, 100K bounded-memory, exact-96 execution,
release, production throughput, or popularity claim. GitHub stars are an
external adoption outcome, not a testable engineering invariant; the project
will target adoption through correctness evidence, documentation, examples,
compatibility, and reliable releases without claiming a guaranteed count.

## 31.34 SQLite-backed baseline relation reconciliation (append-only)

The constant-memory accumulators complete the byte-chain primitive, but a
chain proves only that its entries are ordered and unchanged. Production
migration also has to prove that all entries describe one coherent source-v1
database. This section freezes the next implementation layer without altering
any prior requirement.

### 31.34.1 Transaction-scoped capture API

Add one internal capture/reconciliation API per runtime. It receives the
already-open provider connection, an observed `capturedAtMs`, and a bounded
diagnostic limit. It requires the migration owner to hold `BEGIN EXCLUSIVE`.
It MUST NOT begin, commit, roll back, open a second connection, or continue
after corruption. Its opaque result exposes only the validated source
envelope, exact expected entry count, per-kind counts, maximum observed
provider time, a one-shot canonical entry iterator, a post-publication verifier,
and deterministic disposal.

The TypeScript entry point is
`captureAndReconcileSQLiteV1BaselineSource(connection, options)`. Python uses
`capture_and_reconcile_sqlite_v1_baseline_source(connection, *,
captured_at_ms, diagnostic_limit=16)`. Both implementations have identical
rule IDs and safe diagnostics; no BLOB contents, credentials, request payloads,
or tenant-controlled values enter an error message.

Production must not retain 100K source rows in JavaScript objects, Python
dictionaries, maps, lists, or tuples. Configure bounded FILE-backed SQLite
TEMP behavior before the exclusive transaction, then populate normalized TEMP
relations and a common stage keyed by `(kind_rank, key_blob)`. The common stage
contains exact canonical key/state bytes; relation tables contain only the
minimal indexed identity fields needed for anti-joins and grouped invariants.

### 31.34.2 Normalized relation indexes

The TEMP relation model must include:

- streams keyed by `(tenant, stream)`;
- records keyed by `(tenant, record_id)`, unique by `(tenant, record_hash)` and
  `(tenant, stream, sequence)`, with a stream-position index;
- current checkpoints keyed by `(tenant, scope, checkpoint_id)`;
- revisions keyed by `(tenant, scope, revision)` and indexed by
  `(tenant, scope, checkpoint_id, revision DESC)`;
- leases keyed by `(tenant, stream)`;
- used lease IDs keyed by `(tenant, stream, lease_id)` and unique by
  `(tenant, stream, lease_epoch)`;
- holds keyed by `(tenant, stream, hold_id)`;
- the migration-lock singleton and used migration locks keyed by ID and unique
  by epoch;
- migrations keyed by version; and
- legacy operations keyed by `(tenant, operation_id)`.

Authoritative record values, checkpoint values, cursor state/snapshot BLOBs,
and legacy result BLOBs remain one-row streamed carriers. Validate and hash
them, but never copy them wholesale into the normalized relation stage.

### 31.34.3 Required bidirectional source rules

Schema/source rules:

1. exactly one schema and migration-lock singleton exist;
2. source-v1 contains exactly migration version 1 with previous version 0,
   frozen ID, SQL hash, schema identity, postconditions, and applied time;
3. schema latest-migration fields match that row exactly;
4. source envelope descriptor, schema, lineage ID/hash, application ID, and
   version match the same source; and
5. capture time is at or after the provider clock high-water.

Stream/record rules:

1. every record has exactly one stream;
2. durable positions per stream are exactly `0..tailSequence`, without gap or
   duplicate;
3. position zero has no predecessor and every later row names the exact prior
   position hash;
4. stream tail sequence/hash names its exact final record;
5. record hashes remain tenant-wide unique; and
6. persisted empty streams are rejected because the provider cannot produce
   them as durable state even though the table admits the transient shape.

Checkpoint/revision rules:

1. revision numbers are contiguous from 1 per tenant/scope;
2. every put binds an exact record and has exact summary/outer-state identity;
3. for each checkpoint ID, latest put requires one exact current row and latest
   delete requires no current row;
4. current `checkpointRevision` is the latest revision for that ID, never an
   arbitrary older put; and
5. current/revision binding, summary, value identity, and time agree exactly.

Lease and migration-lock rules:

1. each lease belongs to a stream and each used identity belongs to its lease;
2. epoch and fence high-waters agree;
3. retained used epochs are exactly `1..highWater`, proven by count, minimum,
   maximum, distinct count, and anti-joins;
4. every used epoch equals its fence;
5. active fields are all null or all present;
6. active ID, epoch, fence, and acquisition time match the exact final used
   identity and expiry exceeds acquisition; and
7. migration-lock source/target is forward-only and its global history obeys
   the same complete-epoch rules.

Hold and operation rules:

1. every hold has an exact stream and no source/baseline side has an extra;
2. baseline legacy count equals staged entry count and physical format-1 row
   count;
3. legacy keys and states compare bidirectionally;
4. every result BLOB decodes and re-encodes canonically and matches both result
   hash and raw BLOB SHA-256; and
5. append, checkpoint-save, lease acquire/renew, and migration-lock acquire
   results retain their physical semantic bindings. Request bytes that did not
   exist in v1 are never invented.

### 31.34.4 Clock and cursor seals

Migration-lock `updatedAtMs` is the provider clock high-water. It must be no
earlier than schema creation/update/latest application, migration application,
stream creation/update, record and operation commit, checkpoint commit,
revision recording, lease update, used-ID first use, hold placement,
migration-lock used-ID first use, and cursor creation/consumption. Lease/lock
expiry and user checkpoint RFC3339 timestamps are not provider clock inputs.

Cursors remain outside baseline entries. Before 0002, validate authorization,
scope, canonical BLOBs, positions, expiry, immutable snapshot relations, event
tail binding, and checkpoint revision binding. Stream an ordered cursor seal
over every immutable scalar plus both BLOB SHA-256 values. After updating only
descriptor and schema identity, require the exact update count, identical seal
and row count, and a full v2 cursor audit. Migration never deletes expired or
consumed cursors and never rewrites snapshot bytes.

### 31.34.5 Exact execution order and hostile matrix

Inside one exclusive owner transaction: validate v1 catalog/manifest/FK/full
integrity; observe capture time; stream and stage source plus cursor seal; run
all grouped rules and anti-joins; execute 0002; stream stage order through the
accumulator and insert each entry; publish final header and sequence zero;
rebind cursors; publish lineage/schema/descriptor; verify stored chain, legacy
inventory, cursor seal, catalog, FK, physical and semantic reconciliation; then
commit once. Any failure rolls back every step.

Hostile tests must independently cover record gaps/predecessors/tails/orphans,
checkpoint interleaving/delete/recreate/missing-current/older-put binding,
missing or extra lease/lock epochs and active-ID substitution, lineage/envelope
and capture-watermark drift, legacy insert/delete/result/name/time drift,
cursor insert/delete/immutable drift/partial rebind/bad tail/missing revision,
and exact 100K one-row iteration with no `.all()` or full collection. Stable
rule IDs include `BLR_RECORD_GAP`, `BLR_CHECKPOINT_CURRENT_MISSING`, and
`BLR_LEASE_HISTORY_INCOMPLETE`; diagnostics are capped at the configured limit.

### 31.34.6 Accumulator implementation checkpoint

Both runtimes now implement the expected-count streaming accumulator. The
TypeScript implementation uses ECMAScript `#` private mutable state, cloned
entry buffers, and a frozen projection identity. A hostile test injects public
properties with every internal-looking name and proves count, chain, seal, and
finish remain unchanged. Python uses bounded `__slots__`, immutable bytes,
frozen result dataclasses, full recapture, and no retained collection.

Both accept canonical numeric revision order `1,10,2`, reject `1,2,10`, kind
regression, key regression, duplicate, invalid row, unsafe count, overflow,
underflow, and post-finish append without corrupting the next valid hash. The
materializing convenience builders now feed these accumulators so only one
chain/projection algorithm remains. This checkpoint still does not claim the
database source iterator, relation stage, 100K evidence, or runtime v2.

### 31.34.7 Source summary foundation checkpoint

The first database-facing slice is implemented in both runtimes without
switching the active schema. A caller-owned active transaction can now capture
one validated v1 source envelope, twelve exact family counts, a safe total
expected entry count, and the maximum observed provider time. TypeScript reads
all SQLite integers as BigInt, sums in BigInt, bounds the total, and only then
converts to Number. Python sums arbitrary-precision integers and enforces the
same maximum. Both reject foreign application identity, non-v1 source
identity, missing singleton/lineage, absent transaction, unsafe capture time,
capture before the migration-lock clock, and a migration-lock clock that
predates any represented source or cursor observation.

The provider-time query includes schema creation/update/latest application,
migration application, stream creation/update, record and operation commit,
checkpoint commit, revision record time, lease update, used lease first-use,
hold placement, cursor creation/consumption, used migration-lock first-use, and
migration-lock update. It intentionally excludes expiry and user RFC3339
checkpoint time. Cursors remain excluded from all twelve entry counts.

This is a bounded metadata/count foundation, not the entry iterator or relation
reconciler. The next slice must add one-shot canonical source iteration into a
FILE-backed TEMP stage, finalize every source statement before 0002 DDL, and
then run the §31.34 anti-join rules. `implementationClaim` remains false.

### 31.34.8 Three-family identity iterator checkpoint

The source summary now exposes a fail-closed one-shot iterator for the three
families that completely describe an otherwise empty v1 database:
`schema-envelope`, `migration-lineage`, and `migration-lock-current`. Both
runtimes require the original transaction at iterator acquisition, before each
family, and during each bounded batch. A rollback after the first yield makes
the next read fail rather than mixing snapshots.

The iterator is deliberately unavailable when any remaining family is
nonempty or any identity-family cardinality differs from one. Migration
postconditions are fatal-decoded, duplicate-key/canonical-byte checked, and
compared to the exact fourteen frozen clauses. Schema identity, descriptor,
fresh/alpha lineage pair, user version, migration time, source envelope, and
clock anchors are bound at capture and rechecked during iteration. Returned
nested postconditions cannot be mutated before accumulator append.

This checkpoint proves empty-v1 identity capture only. The nine data families,
TEMP staging, relation anti-joins, cursor seal, and 100K path remain open.

### 31.34.9 Stream-head and record-identity carrier checkpoint

The next dependency-ordered source slice is now implemented symmetrically in
TypeScript and Python. The one-shot v1 iterator covers five entry families in
their protocol rank order: `schema-envelope`, `migration-lineage`,
`stream-head`, `record-identity`, and `migration-lock-current`. A source is
still rejected before iteration if any of the seven not-yet-implemented entry
families is nonempty. Exact counts captured by the source summary are compared
again after each streamed data family so insert/delete cardinality drift cannot
silently change the baseline.

Stream keys are selected in canonical key-byte order (`stream_id` then
`tenant_id`, both binary) and record keys in canonical key-byte order
(`record_id` then `tenant_id`, both binary). Rows are consumed through native
iterators/fixed `fetchmany(256)` batches rather than `.all()`, `fetchall()`, or
an application collection. Transaction liveness is tested before every native
step and again before every yielded/batched row; ending the caller transaction
between two yields is fatal even when Python already has more rows in the same
bounded batch.

The record payload omissions are now earned rather than assumed. Before a
`record-identity` entry can omit `value_blob` and `record_blob`, both runtimes:

1. bound and type-check every selected carrier;
2. fatal-decode the complete record through the runtime storage codec;
3. require every duplicated scalar column to equal the decoded record;
4. require the full record BLOB to equal the canonical re-encoding;
5. require the value BLOB to equal the canonical re-encoding of the embedded
   value, including valid one-byte scalar JSON values;
6. require declared value bytes to equal the actual value BLOB length; and
7. recompute and compare the canonical value hash before emitting only the
   bounded identity state.

Native hostile tests build a real one-byte scalar record, prove exact family
ordering and identity output, then mutate only `value_blob` and require the
source iterator to fail closed. Current evidence is TypeScript 14 test files /
117 tests plus package typecheck and lint; Python source and baseline 27 tests,
Ruff, and strict MyPy. This checkpoint does **not** claim stream/record relation
reconciliation: contiguous chains, predecessor hashes, exact tails, global
record-ID uniqueness, and source-to-TEMP bidirectional anti-joins remain
mandatory in §31.34.3.

Seven entry families remain before full source coverage:
`checkpoint-current`, `checkpoint-revision`, `lease-current`,
`used-lease-identity`, `legal-hold`, `used-migration-lock-identity`, and
`legacy-operation`. After those iterators land, the next gates remain the
FILE-backed TEMP relation stage, cursor seal/rebind proof, 100K constant-memory
run, atomic 0002 execution/publish, crash-boundary rollback matrix, and the
exact 96-case implementation-claim switch.

### 31.34.10 Capture-transaction continuity and bounded-carrier closure

The first hostile review of §31.34.9 found three release-blocking gaps. The
five-family iterator checked only whether some transaction was active, so a
rollback followed by a new begin could resume an old capture; exact family
counts did not catch count-preserving updates; and Python fetched 256 record
rows even though each row may carry roughly three MiB of omitted payload.

Both runtimes now establish a transaction-generation sentinel by enabling
transaction-local `defer_foreign_keys`, freeze the same-connection
`total_changes()` counter after the summary is captured, and validate both
sentinels at iterator acquisition, before every family, before and after each
native step, before every buffered row/yield, and at family completion. A
commit or rollback resets the transaction-local sentinel. Any main or TEMP
write after capture changes the frozen counter. Therefore an old iterator
cannot continue accidentally in a replacement transaction and an update or
delete-plus-insert cannot retain the same baseline identity while changing
entry bytes.

This source-only API deliberately forbids all writes between summary capture
and complete iterator consumption. The future FILE-backed TEMP staging API
must consume source rows internally and advance a private allowed-write guard,
or finish each source statement into the stage before exposing control. It
must not weaken the public capture guard or treat arbitrary caller writes as
staging. Explicit rollback-plus-rebegin and same-count stream-renaming attacks
now fail in both runtimes.

Python family metadata now carries a fetch size. Metadata-only families and
stream heads retain bounded 256-row batches, while every record row is fetched
alone because it contains both `value_blob` and `record_blob`. Checkpoint
current and legacy-operation rows must also use fetch size one when added;
checkpoint revisions and bounded scalar families may use a larger fixed batch
only after their maximum row width is calculated and documented.

Updated evidence after these repairs: TypeScript SQLite 14 test files / 118
tests plus typecheck; Python focused source/baseline 28 tests, Ruff, and strict
MyPy. The previously recorded 117/27 counts remain an immutable historical
checkpoint rather than being edited in place. Relation reconciliation,
deterministic early-abandon disposal, shared `BLR_*` diagnostics, multi-row
cross-language byte fixtures, and the seven remaining source families are
still open and must close before migration code may consume this iterator.

### 31.34.11 Non-replayable transaction epoch correction

A second hostile review proved that the transaction-local PRAGMA sentinel in
§31.34.10 was only a reset signal, not an identity: a caller could rollback,
begin again, set the public bit back to one, and continue. The implementation
therefore removes that PRAGMA write entirely; source capture no longer changes
foreign-key deferral or any caller-visible constraint failure boundary.

TypeScript now obtains a monotonic epoch from `SQLiteConnection`. Every trusted
transaction/control execution and every owner-managed begin, commit, or
rollback advances the epoch. Prepared transaction-control statements are
rejected so they cannot bypass the owner counter. A capture freezes the epoch
and every iterator boundary compares it. Python installs an allow-all SQLite
authorizer only after the read-only summary succeeds; the authorizer increments
an opaque state object for every SQLite transaction or savepoint action. The
summary freezes that epoch and rejects any later difference. Neither mechanism
is derived from writable database state or a replayable PRAGMA value.

Hostile tests now execute `rollback -> begin -> defer_foreign_keys=ON -> next`
and still fail in both runtimes. The same-connection `total_changes()` seal is
retained for this source-only iterator and independently blocks count-preserving
DML. It is not the final staging architecture: a future module-owned
source-to-TEMP consumer must distinguish its own expected TEMP writes from
unauthorized source writes while retaining the transaction epoch. Until that
internal consumer exists, arbitrary writes between capture and completion are
intentionally rejected.

This correction supersedes only the PRAGMA-generation mechanism described in
§31.34.10; the historical finding, record fetch-size repair, tests, remaining
relation work, and non-claim boundary remain valid.

### 31.34.12 Exclusive owner and raw-handle closure

Further hostile review found two bypasses in the first epoch implementation.
SQLite accepts empty statements before a real statement, so `; BEGIN` and
`;;/*comment*/ ROLLBACK` bypassed a tokenizer that skipped only whitespace and
comments. Python also returned a native cursor whose public `.connection`
attribute leaked the raw handle around the owner epoch.

Both SQL tokenizers now skip any interleaving of empty semicolon statements,
whitespace, line comments, and block comments before classifying the first
real token. TypeScript rejects prepared BEGIN, COMMIT/END, ROLLBACK, SAVEPOINT,
and RELEASE after every such prefix. Tests execute block-comment, line-comment,
single-semicolon, multiple-semicolon, and mixed-comment attacks. Python uses
the same classification for its transaction/savepoint epoch and additionally
tests a prefixed `ROLLBACK TO` against a savepoint created before capture.

Python no longer accepts an externally created raw connection. The baseline
connection owner opens its database location internally and never returns the
native connection. `execute` returns a minimal cursor capability exposing only
`fetchone`, bounded `fetchmany`, and `close`; it has no `.connection`,
transaction, authorizer, or arbitrary statement surface. This is an internal
ownership and accidental-misuse boundary, not a sandbox against malicious
Python reflection. Future provider integration must adopt this owner from
connection creation and must not open a second connection for migration.

The fourth read-only hostile pass reports no remaining HIGH or MEDIUM finding
for this five-family source-only milestone. Current focused evidence is
TypeScript SQLite 14 files / 119 tests and Python source/baseline 29 tests, plus
both strict typecheck/lint paths. Full-plan completion remains false: the seven
remaining families, stage/relation/cursor/100K/atomic-v2/runtime gates listed
above are unchanged.

### 31.34.13 Checkpoint current and revision carrier checkpoint

The v1 iterator now covers seven protocol families in both runtimes by adding
`checkpoint-current` and `checkpoint-revision` between record identity and
migration-lock current. Five families remain unimplemented:
`lease-current`, `used-lease-identity`, `legal-hold`,
`used-migration-lock-identity`, and `legacy-operation`. Any nonempty remaining
family still prevents iterator acquisition.

Checkpoint-current reads exactly fourteen columns, one row/carrier at a time,
and orders by checkpoint ID, checkpoint scope, and tenant with binary
collation so database order equals canonical key-byte order. Before omitting
the checkpoint payload, the iterator independently proves:

1. value bytes are 1..16 MiB and exactly equal the declared length;
2. scalar, array, and object values are accepted through the shared checkpoint
   codec rather than an object-only baseline decoder;
3. checkpoint BLOB size is between value size and 17,825,792 bytes, fatal
   decodes, and byte-equals its canonical re-encoding;
4. embedded value bytes and recomputed canonical hash equal their columns;
5. every duplicated scope/ID/stream/record/time/hash/length scalar matches;
6. summary BLOB is 2..1 MiB, shared-ledger decodes, byte-equals the shared
   encoder output, and exactly equals the checkpoint with only value removed;
7. revision/commit integers are safe and the final baseline key/state passes
   the closed cross-language validator.

Checkpoint revisions read twelve columns and order by scope, decimal revision
text, and tenant. This intentionally produces `1,10,2`, matching canonical JSON
key bytes instead of numeric business order. Put rows require all six payload
columns, validate the shared summary codec and every outer identity, and bound
revision/value/time fields. Delete rows require those same six columns to be
explicit NULL and emit six explicit null state fields. Unknown or partially
null actions fail before hashing.

Native tests cover a one-byte scalar checkpoint, exact seven-family rank,
revision `1,10,2`, put and delete states, mismatch in current summary, mismatch
in revision summary, partial-delete payload hidden behind disabled CHECK
constraints, value/checkpoint/summary carrier mutations, and outer identity
drift. TypeScript package evidence remains 14 files / 119 tests plus
typecheck/lint/build; Python focused baseline/source evidence is 36 tests plus
Ruff and strict MyPy. A read-only hostile audit reports no local HIGH/MEDIUM.

This checkpoint is carrier-local only. It does not permit migration
consumption until the FILE-backed relation stage proves exact record binding,
contiguous revision histories, current-to-latest-put equality, absence of
current after latest delete, bidirectional source/stage coverage, stable
`BLR_CHECKPOINT_CURRENT_MISSING` diagnostics, and deterministic source cursor
finalization before 0002 DDL.

### 31.34.14 Revision row-width closure

Independent Python hostile review found that a 256-row revision batch could
materialize more than 256 MiB because every legal put may contain a 1 MiB
summary. Checkpoint revisions now use `fetchmany(1)`, matching current, record,
and TypeScript one-row carrier behavior. A monkeypatched cursor-capability test
asserts the entire family fetch sequence, including four one-row calls for
three revision rows plus exhaustion, so the bound cannot silently regress.
The re-review reports HIGH 0 / MEDIUM 0 for this carrier-local slice.

### 31.34.15 Scalar lease, hold, and used-identity carrier checkpoint

The source iterator now covers eleven of the twelve frozen entry kinds in both
native runtimes. `lease-current`, `used-lease-identity`, `legal-hold`, and
`used-migration-lock-identity` are streamed after checkpoint revisions and in
their frozen kind-rank positions around the migration-lock singleton. Their
SQL order is the exact canonical key-byte order: stream then tenant for the
lease singleton; lease ID, stream, then tenant for used lease identities; hold
ID, stream, then tenant for holds; and lock ID for used migration-lock
identities.

All four families pass through the closed baseline key/state validator. An
active lease is either entirely absent or has all six active fields; its epoch
and fence equal each other and the retained high-water; expiry is after
acquisition. Every used lease and migration-lock identity has equal epoch and
fence. Identifiers, safe timestamps, key/state duplication, and family counts
are validated before the entry can reach an accumulator. Bounded scalar
families use fixed 256-row Python batches; TypeScript advances the native
iterator one row at a time.

Native hostile coverage includes inactive and active leases, partial-active
nulls, active/high-water drift, used-identity fence drift, invalid hold IDs,
canonical lexical ordering with `-10` and `-2`, and accumulator acceptance.
Independent TypeScript review found no HIGH or MEDIUM implementation issue.
This checkpoint proves only each row's local carrier. Complete used-epoch
histories, exact stream ownership, active-to-final-used identity, and hold
stream membership remain mandatory TEMP relation rules.

### 31.34.16 Twelve-family source closure and legacy-result boundary

`legacy-operation` completes the twelve-family source iterator in TypeScript
and Python. It selects exactly seven columns and orders by operation ID then
tenant with binary collation. Each row is advanced alone because a legal v1
result carrier may be 16 MiB. The operation name is checked against the closed
nine-mutation set before codec dispatch. The result BLOB must be bytes between
2 and 16,777,216 bytes, decode under the operation-specific shared codec,
re-encode byte-for-byte identically, and hash logically to the stored result
hash. A separate SHA-256 over the original BLOB bytes becomes
`resultBlobSha256`; it is not copied from or substituted for the logical hash.

The baseline state retains only committed time, operation ID/name, request
hash, result BLOB SHA-256, logical result hash, and tenant. It never retains or
logs result bytes. Codec and validation failures collapse to fixed safe error
messages; Python suppresses the decoder exception chain. Tests cover all nine
closed result shapes, including JSON null, false, nested append/lease/lock
objects, canonical operation/tenant tie ordering, raw and logical hash
separation, unknown operation, wrong-operation shape, noncanonical bytes,
one-byte and over-16-MiB carriers, identity/hash/time drift, and a marker that
must not appear anywhere in the surfaced error chain.

The v1 request hash is retained but cannot be recomputed because v1 never
stored request bytes. `legacyRequestRecovery:false` remains normative. This
source closure must never be described as request recovery, replay closure, or
runtime-v2 completion. The relation stage must still prove the physical
bindings that v1 results can support: append tail and retained span;
save-checkpoint exact put revision; acquire/renew lease exact used identity;
and acquire-migration-lock exact used identity. Delete, release, and hold
results cannot reconstruct an absent historical request and must not be given
invented bindings.

The carrier-local evidence at this checkpoint is TypeScript SQLite 14 files /
121 tests plus typecheck, lint, and build; Python source 39 tests plus Ruff and
strict MyPy over both implementation and tests. A complete Python run reported
1,206 passes before the final type-annotation-only test repair. The frozen
ledger contract remains 14/14 with `implementationClaim:false`. Independent
audits report no remaining HIGH or MEDIUM carrier finding after the strict
MyPy correction.

### 31.34.17 FILE-backed TEMP reconciliation execution backlog

The next implementation is deliberately split so carrier closure cannot be
mistaken for migration closure. Every boundary below requires TypeScript and
Python parity, native hostile tests, bounded diagnostic output, and no active
schema switch.

#### 31.34.17.1 Protocol and owner capability slice

1. Freeze a shared `BLR_*` rule registry, diagnostic envelope, cursor-seal row
   domain, cursor-seal chain domain, empty root, and cross-language fixture.
2. Add an owner-only TEMP configuration API. Outside any transaction it sets
   and reads back `temp_store=FILE`, a bounded negative TEMP cache size, and
   cache spill. It must never set `temp_store_directory`.
3. Extend the owned connection state so reconciliation proves the current
   transaction was begun as `EXCLUSIVE`, not merely that some transaction is
   active. Prepared or raw transaction-control bypasses remain forbidden.
4. Add a module-private exact-write capability. Each expected TEMP insert must
   change exactly one row and advance a private allowed `total_changes`
   counter. Any unexplained main- or TEMP-database write poisons capture.
5. Keep the existing public source iterator read-only. Do not weaken its
   frozen `total_changes` contract; the private reconciler consumes the shared
   row decoder through a separate controlled path.

Acceptance attacks include TEMP configuration inside a transaction,
non-FILE readback, non-exclusive capture, zero-row/duplicate/replace/ignore
stage writes, caller DML between rows, rollback/rebegin, prefixed transaction
control, owner-handle escape, and errors containing tenant-controlled data.

#### 31.34.17.2 Common stage and normalized relations

Create a STRICT, WITHOUT ROWID TEMP common stage keyed by
`(kind_rank,key_blob)` with exact canonical key/state BLOB bounds and a unique
`(entry_kind,key_blob)` identity. Create twelve normalized relation tables,
each carrying the entry key BLOB plus only the indexed scalars required for
reconciliation:

- schema singleton and migration lineage;
- streams and record identities with unique tenant/hash and
  tenant/stream/sequence indexes;
- current checkpoints and revisions with checkpoint-ID/latest-revision and
  exact record-binding indexes;
- leases, used leases, holds, migration-lock singleton, and used lock IDs with
  epoch/fence uniqueness;
- legacy operations with only decoded result-binding scalars, never the
  result BLOB.

For each source row, decode and validate the carrier, encode the canonical
entry, insert one common-stage row, insert one relation row, verify both exact
write deltas, then release the source row before advancing. Record,
checkpoint-current, checkpoint-revision, and legacy carriers remain one-row
reads. Every statement is finalized before anti-joins or future 0002 DDL.

Build a union relation-key view and prove common-stage to relation and relation
to common-stage coverage in both directions. Compare grouped rank counts to
all twelve captured source counts. Duplicate canonical keys, missing relation
rows, extra relation rows, rank/kind mismatch, count drift, early iterator
abandonment, poison-after-failure, and idempotent deterministic disposal are
release-blocking tests.

#### 31.34.17.3 Relational invariant slice

Implement bounded count/anti-join rules with stable IDs and no raw identities
in messages:

- `BLR_RECORD_STREAM_MISSING`, `BLR_STREAM_EMPTY`, `BLR_RECORD_GAP`,
  `BLR_RECORD_PREDECESSOR`, and `BLR_STREAM_TAIL` prove exact durable record
  histories and reject persisted empty streams.
- `BLR_CHECKPOINT_REVISION_GAP`, `BLR_CHECKPOINT_RECORD_MISSING`,
  `BLR_CHECKPOINT_CURRENT_MISSING`, `BLR_CHECKPOINT_CURRENT_UNEXPECTED`,
  `BLR_CHECKPOINT_CURRENT_STALE`, and `BLR_CHECKPOINT_CURRENT_BINDING` prove
  revision continuity, put-record identity, latest put/delete semantics, and
  exact current state.
- `BLR_LEASE_HISTORY_INCOMPLETE`, `BLR_LEASE_ACTIVE_BINDING`,
  `BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE`, and
  `BLR_MIGRATION_LOCK_ACTIVE_BINDING` prove complete `1..highWater` histories,
  epoch/fence equality, final active identity, acquisition time, expiry, and
  forward-only migration targets.
- `BLR_HOLD_STREAM_MISSING` proves every hold belongs to an exact stream.
- `BLR_LEGACY_INVENTORY`, `BLR_LEGACY_APPEND_BINDING`,
  `BLR_LEGACY_CHECKPOINT_BINDING`, `BLR_LEGACY_LEASE_BINDING`, and
  `BLR_LEGACY_LOCK_BINDING` prove the recoverable result-to-physical
  relationships without inventing legacy requests.

Each rule gets a happy case plus isolated orphan, gap, predecessor, tail,
interleaved revision, delete/recreate, stale current, missing epoch, extra
epoch, substituted active ID, forged result, and count-preserving mutation
attacks. Diagnostics report only rule ID, capped violation count, and
truncation status.

#### 31.34.17.4 Cursor seal and staged output slice

Scan cursors one row at a time in canonical token/tenant order. Validate the
authorization, request scope, canonical scope and snapshot BLOBs, position,
expiry, consumption, descriptor/schema identity, event-tail binding, and
checkpoint-revision binding. The immutable seal row includes every scalar
that 0002 is forbidden to alter plus each BLOB length and SHA-256; descriptor
and schema identity are validated separately because they are the only fields
later rebound.

After staging, expose a one-shot iterator over
`ORDER BY kind_rank,key_blob`. It round-trips exact key/state bytes, checks the
same transaction epoch, and feeds the streaming accumulator without a full
collection. Disposal closes any active iterator and drops the cursor seal,
relation view/tables, and common stage in reverse order without committing or
rolling back the caller transaction.

Cursor tests cover empty/event/checkpoint forms, principal or authorization
drift, bad canonical BLOBs, missing tail, missing historical put, bad snapshot
order, row insert/delete, partial rebind, wrong update count, immutable byte
drift, and TypeScript/Python seal-root parity.

#### 31.34.17.5 Scale and handoff gates

The fast gate uses 128 and 1,024 generated rows. Scheduled gates use exact 10K
and 100K source rows without `.all()`, `fetchall()`, a 100K array, tuple, map,
or dictionary. Evidence records source/stage/relation counts, root parity,
fetch sizes, query plans and index use, TEMP page count, database/WAL/SHM
sizes, raw latency samples, p50/p95/p99, and peak RSS. RSS is initially
reported, not converted into an unstable threshold. `releaseGate:false`,
`productionThroughputClaim:false`, and `implementationClaim:false` remain set.

Only after these slices pass may the migration orchestrator execute 0002,
stream stage rows into permanent baseline entries, publish header and sequence
zero, rebind cursors, publish lineage/schema/descriptor, run the
post-publication verifier, and commit once. Crash injection, subprocess
SIGKILL, request bytes, sequence CAS, deterministic replay, bidirectional
physical reconciliation, backup/restore identity, exact 96 implementation
evidence, artifact installation, and active-manifest switching remain separate
subsequent gates.

### 31.34.18 Reconciliation registry and owner/TEMP preparation checkpoint

The first §31.34.17 implementation slice is now protocol-backed in both native
runtimes without creating a relation table or executing 0002.

The cross-language reconciliation registry freezes 53 ordered `BLR_*` IDs and
their phases, the twelve baseline kind ranks, an executable three-field safe
diagnostic envelope, FILE-backed TEMP defaults and bounds, and the preliminary
cursor-seal domains and immutable field inventory. Registry status is
`registry-frozen`, not complete cursor protocol. `implementationClaim`,
`releaseGate`, `productionThroughputClaim`, and `cursorSeal.protocolClaim` are
all false. The empty cursor root remains explicitly deferred until independent
TypeScript and Python derivations agree.

Diagnostic validation is executable rather than declarative. A diagnostic has
exactly `ruleId`, `violationCount`, and `diagnosticsTruncated`; the rule must be
registered; the configured limit is a safe integer from 1 through 64; emitted
count equals `min(actualViolationCount, configuredLimit)`; truncation is true
if and only if actual count exceeds the configured limit. Unknown fields,
tenant/payload fields, wrong scalar types, negative counts, false truncation,
rule omission/duplication/reordering, phase drift, domain drift, memory TEMP,
and accidental release claims are hostile-test failures.

Both owners now distinguish deferred, immediate, exclusive, and unknown
transaction modes. Baseline source capture and every iterator boundary require
an owner-observed EXCLUSIVE transaction. A multi-statement commit/rebegin swap,
including a swap followed by a failing statement, cannot carry an old
EXCLUSIVE proof. TypeScript transaction scripts conservatively discard mode
when transaction control or an additional statement makes generation
ambiguous. Python `executescript` always advances the epoch and reports an
active result as unknown. Savepoint-only transactions never acquire an
EXCLUSIVE proof.

`temp_store_directory` is rejected before execution by both owners, including
unqualified, `main.`/`temp.` qualified, quoted, bracketed, commented,
case-varied, prefixed-semicolon, and later-statement spellings. False-positive
denial is permitted because the provider never needs this deprecated global
directory control. TEMP configuration occurs only in autocommit and reads back:

- `temp_store=FILE`;
- negative KiB `temp.cache_size`, default 8,192 and bounded 1,024..65,536; and
- unqualified `cache_spill=ON` with nonzero readback.

TypeScript exposes an internal frozen EXCLUSIVE proof containing mode and
transaction epoch. Python exposes the same conservative owner state. Neither
stage module is publicly exported and neither accepts a directory path.

The public source iterator retains its no-write contract. TypeScript already
advances the epoch for every trusted execution. Python now advances its epoch
for transaction control plus `ALTER`, `ANALYZE`, `ATTACH`, `CREATE`, `DETACH`,
`DROP`, `PRAGMA`, `REINDEX`, and `VACUUM`; DML remains independently caught by
`total_changes`. Hostile tests prove that capture followed by TEMP DDL, whole-
database `ANALYZE`, or table-specific `ANALYZE` cannot stream entries. The
future private reconciler must replace this blanket rule with an exact
allowlisted TEMP-write delta; it must not weaken this public iterator.

Hostile review found and closed two TypeScript HIGH issues: EXCLUSIVE mode
survived a transaction swap, and directory PRAGMA filtering inspected only an
insufficient prefix. It also found and closed Python protocol drift in the
cache default/bounds, a directory PRAGMA bypass, missing cache selection,
qualified spill readback, and unexplained DDL/ANALYZE writes. Registry review
closed phase, actual-diagnostic, and cursor non-claim gaps. The remaining
Python raw sqlite exception surface is internal and LOW; relation code must
continue to collapse tenant-controlled failures into the safe `BLR_*`
envelope before exposure.

Current checkpoint evidence is TypeScript SQLite 15 files / 128 tests plus
typecheck, lint, and build; reconciliation registry 5 tests; complete SQLite
ledger-contract command 19 tests; 286 documentation links; Python focused
source/stage 46 tests plus Ruff and strict MyPy. The last complete Python run
before the two added `ANALYZE` parameter cases was 1,211 passes; a final full
run is required before this slice is published.

The next implementation slice is the common STRICT/WITHOUT ROWID TEMP stage,
twelve normalized relation DDL definitions, exact module-private write deltas,
bidirectional stage/relation key coverage, deterministic disposal, and no-
collection tests. Relational anti-joins, cursor-chain roots, 100K evidence,
0002, publication, crash recovery, replay, and the 96-case implementation
switch remain open.

### 31.34.19 Owner write-fence and final-evidence correction

The final cross-language review found that a prepared TypeScript DDL statement
could bypass the owner epoch even though trusted scripts and Python were
closed. `SQLiteConnection.prepare` now wraps every prepared schema/PRAGMA
statement and advances the owner epoch before `all`, `get`, `iterate`, or
`run`. A capture followed by prepared `CREATE TEMP TABLE` therefore fails the
same transaction-change guard as trusted DDL. TEMP profile readback now also
rejects any active TypeScript transaction, matching Python and the registry.

The owner parser now accepts valid inline/trailing comments in
`BEGIN EXCLUSIVE`. Single SAVEPOINT, `ROLLBACK TO`, and RELEASE preserve the
outer EXCLUSIVE mode while advancing the epoch, so an old proof is invalid but
a new proof correctly describes the unchanged outer transaction. Ambiguous
multi-statement control still degrades to unknown.

Final evidence superseding the pending counts in §31.34.18 is TypeScript
SQLite 15 files / 129 tests plus typecheck, lint, and build; Python 1,213 full
tests, 46 focused source/stage tests, Ruff, and strict MyPy; reconciliation
registry 5 tests; full SQLite ledger-contract 19 tests; and 286 documentation
links. `git diff --check` is clean. This correction changes no relation,
cursor-root, migration, release, or popularity claim.

### 31.34.20 FILE-backed common stage and normalized carrier checkpoint

The second §31.34.17 implementation slice now has a transaction-bound TEMP
catalog foundation in both native runtimes. This checkpoint deliberately does
not claim that the twelve source families are loaded into their relation
tables. It proves the catalog, common-row write fence, lifecycle, empty and
hostile coverage machinery needed by that next step.

Both implementations require the bounded FILE TEMP profile to be retained
before they create any object. Stage construction occurs only under the exact
owner-observed EXCLUSIVE transaction. A stale proof, deferred/immediate/
unknown transaction, missing FILE profile, memory TEMP, cache outside
1,024..65,536 KiB, disabled spill, pre-existing reserved object, repeated
stage, transaction swap, unexplained row write, or caller schema mutation
fails closed. Reserved-name discovery is case-insensitive because SQLite
identifiers are case-insensitive; uppercase and mixed-case `GE_BLR_*` residue
cannot bypass the owner fence.

The fixed catalog consists of:

- `ge_blr_stage`, with exact kind-rank discrimination, canonical key/state
  size bounds, composite primary key, and unique kind/key identity;
- twelve `STRICT, WITHOUT ROWID` normalized carrier tables in frozen baseline
  rank order;
- ten named indexes, including record hash/position, checkpoint binding and
  latest-revision paths, and separate epoch/fence uniqueness for used lease
  and migration-lock identities; and
- `ge_blr_relation_keys`, a twelve-arm `UNION ALL` key-only view carrying
  exactly `(kind_rank,key_blob)`.

The relation DDL now carries every scalar required by the planned anti-joins.
Schema envelope includes compatibility versions and creation/update clocks.
Streams enforce the `-1`/null empty-tail sentinel. Records enforce sequence
zero/null predecessor and positive-sequence/non-null predecessor. Checkpoint
revisions enforce all-present put carriers and all-null delete carriers.
Active lease and migration-lock rows enforce all-null/all-present identities,
epoch/fence/high-water equality, expiry ordering, and forward migration
targets. Used identities enforce positive equal epoch/fence values. Legacy
operations reserve the exact decoded A/C/D/L/R/M scalar groups and use a
closed nine-operation discriminator so one result cannot smuggle fields from
another operation.

Catalog creation freezes `total_changes` before the first DDL and proves no
row write occurred. Post-creation validation checks the exact reserved
type/name set and all thirteen table `STRICT`/`WITHOUT ROWID` flags. Common
insertion revalidates canonical bytes against the selected entry kind and the
key/state shared-identity contract, then requires both statement-local
`changes == 1` and global `total_changes == before + 1`. Duplicate keys,
wrong-kind bytes, cross-identity bytes, zero/multi-row effects, and external
DML permanently poison the stage.

Both runtimes expose exact twelve-kind grouped/total common-count assertions
and bidirectional common-to-relation/relation-to-common key anti-joins. The
current tests exercise empty coverage and hostile missing/extra/rank/count
paths. Python hostile tests use an explicitly test-only adoption hook to place
synthetic relation rows because the production controlled relation writers
remain open; that hook is not implementation evidence for per-source paired
writes.

Disposal is idempotent and never commits or rolls back. When ownership is
still current it drops view, indexes, relation tables, and common stage in
strict reverse order, continues after individual drop failures, verifies the
reserved namespace is empty, and reports a poisoned failure if cleanup is
incomplete. When rollback/rebegin or another epoch change makes ownership
stale, disposal performs no named database operation, preventing an old stage
from deleting caller replacement objects. Repeated creation is rejected
before profile PRAGMA readback can invalidate the live stage.

Checkpoint evidence is TypeScript SQLite 15 files / 144 tests plus typecheck,
lint, and build; Python 1,237 full tests and 28 focused stage tests plus Ruff
and strict MyPy over the changed implementation/tests; complete SQLite ledger,
reconciliation, and migration contract 19 tests; and clean scoped
`git diff --check`. The final independent hostile review reported HIGH 0,
MEDIUM 0, and LOW 0 after closing repeated-create epoch invalidation,
case-insensitive namespace bypass, legacy NULL smuggling, exact count-map
shape, and failure-after-catalog-PRAGMA cleanup residue.

No production relation decoder/writer, non-test common+relation paired write,
full source consumer, one-shot ordered staged output, relational invariant
rule, cursor seal/root, 10K/100K evidence, 0002 execution, permanent baseline
publication, crash/replay proof, release gate, production-throughput claim,
or popularity outcome is completed by this checkpoint.

### 31.34.21 Controlled relation loading and real coverage execution plan

This is the immediate next implementation slice and must finish before any
§31.34.17.3 relational rule begins. Run TypeScript and Python lanes in
parallel, but require one shared fixture and a final cross-runtime audit before
integration.

#### 31.34.21.1 Module-private write capability

Add a module-private relation writer bound to one live stage. It accepts no
SQL, table name, column name, directory, transaction command, or raw owner
handle from callers. The only public-to-module input is one already validated
baseline source entry plus the exact decoded physical carrier produced by its
source-family adapter.

For every source item, execute exactly two static parameterized writes:

1. insert `(kind_rank,entry_kind,key_blob,state_blob)` into `ge_blr_stage`;
2. insert the closed scalar projection and identical `key_blob` into exactly
   one rank-matched relation table.

Before each statement require open state, unchanged EXCLUSIVE epoch, and
`actual_total_changes == allowed_total_changes`. After each statement require
statement-local `changes == 1` and global delta exactly one, then increment
the private allowance. No `OR IGNORE`, `OR REPLACE`, UPSERT, trigger,
`RETURNING`, dynamic identifier, multi-statement script, or caller-provided SQL
is permitted. If the first insert succeeds and the relation insert fails, the
stage becomes permanently poisoned and the caller must roll back; the writer
must never delete or retry the common row to simulate atomicity.

#### 31.34.21.2 Twelve closed decoders

Implement one bounded decoder/projector per frozen kind. Each projector must
recapture the canonical entry and prove all key/state shared fields before
returning its closed parameter tuple.

- Schema copies singleton, compatibility versions, three hashes, migration
  time, and creation/update clocks.
- Migration lineage copies the version edge, migration ID, SQL/schema hashes,
  and applied time; structured postconditions and reversibility remain in the
  canonical state BLOB and are checked by the source codec.
- Stream and record copy exact tenant/stream/record identities, sequence,
  predecessor/tail hashes, value hash/length, and clocks.
- Checkpoint current and revision copy the full scalar binding, including
  checkpoint creation time; delete revisions bind no put carrier.
- Lease and migration-lock current rows copy exact active/high-water state;
  used identities copy only fields present in the baseline protocol, never
  invented holder/owner/version values.
- Legal holds copy tenant/stream/hold identity and placement time.
- Legacy operation loading must decode and byte-reencode the raw v1 result,
  prove logical result hash and independent raw BLOB SHA-256, populate only
  the operation-selected nullable group, convert lease/lock timestamps to
  exact epoch milliseconds, and leave non-recoverable request/governance
  details unclaimed.

All large carriers remain one-row reads. The decoders may retain one entry and
one result carrier only; they may not call `.all()`, `fetchall()`, or build a
cross-source collection.

#### 31.34.21.3 Real count and bidirectional coverage barrier

Maintain a twelve-element source count vector while streaming. After all
source cursors are finalized, require for every rank:

- source count equals common-stage count;
- source count equals its relation-table count;
- grouped rank/kind common count equals the same value; and
- the sum equals source summary total and common/relation view totals.

Then run both anti-joins on `(kind_rank,key_blob)` and reject the first capped
batch of missing/extra identities through safe registered diagnostics. No key,
tenant, payload, SQL text, or BLOB is exposed in the diagnostic. Stable IDs for
this barrier must be added to the frozen registry before implementation uses
them; do not overload an unrelated `BLR_*` ID.

#### 31.34.21.4 Hostile and scale matrix

Add isolated tests for every kind plus cross-kind attacks: duplicate canonical
key, relation duplicate, wrong relation, wrong rank, changed relation key,
missing relation row, extra relation row, count-preserving replacement,
partially null carrier, legacy cross-operation column smuggling, timestamp
off by one millisecond, external DML between common and relation writes,
prepared DDL/PRAGMA, rollback/rebegin, repeated creation, early source
abandonment, write-count spoofing, cleanup failure, and poison reuse.

The fast gate streams exact 128 and 1,024 mixed-kind rows with bounded fetches
and no collection. It records exact source/common/relation counts and proves
the view count equals the sum of twelve relations. This gate is correctness
evidence only, not a production-throughput claim.

#### 31.34.21.5 Completion gate

This slice completes only when both runtimes pass focused tests, complete
SQLite/Python suites, typecheck/lint/build, Ruff, strict MyPy on changed
modules, ledger/reconciliation contracts, scoped diff check, and two hostile
reviews with no unresolved HIGH or MEDIUM. The plan/log must record exact
counts and explicitly keep 0002, permanent writes, cursor root/rebind, 100K,
crash recovery, replay, release, and adoption claims false.

### 31.34.22 Source consumer and ordered handoff backlog

After §31.34.21, add a private reconciler that invokes the twelve source
families in frozen rank order, finalizes every statement on success/failure/
early abandonment, loads the paired stage rows, executes the coverage barrier,
and exposes a one-shot iterator over
`ORDER BY kind_rank,key_blob`. The iterator revalidates transaction epoch and
allowed write count at every boundary, round-trips canonical bytes, advances
the constant-memory accumulator, and poisons on a second iteration or early
external mutation. Disposal must close the active iterator before the reverse
catalog drop. This slice still executes no 0002 and writes no permanent v2
row.

### 31.34.23 First relational invariant campaign backlog

Only after real paired loading and ordered handoff are green, implement the
stream/record campaign first: missing stream, forbidden persisted empty
stream, sequence gap, predecessor mismatch, tail mismatch, and duplicate hash.
Use bounded count/existence queries and prove the query planner uses the named
record indexes. Freeze shared happy/hostile fixtures and exact safe diagnostic
outputs so TypeScript and Python are deeply equal. Subsequent checkpoint,
lease, lock, hold, legacy, cursor, migration, crash, and scale campaigns remain
separate append-only checkpoints.

### 31.34.24 Twelve-family paired relation-writer checkpoint

The controlled writer portion of §31.34.21 is now implemented in both native
runtimes as an internal stage capability. For one recaptured canonical entry,
the writer projects exactly one frozen relation tuple, inserts the common row,
inserts the rank-matched relation row, and proves each statement changed
exactly one row. The resulting allowed `total_changes` advance is therefore
exactly two. There is no dynamic table/column input, UPSERT, replace, ignore,
trigger, caller SQL, compensating delete, retry, transaction boundary, 0002
execution, or permanent baseline write.

All eleven directly recoverable kinds use closed named statements and exact
column tuples. Checkpoint revision `stream_id` is taken from the validated put
summary and remains null for delete. Structured migration postconditions,
checkpoint summaries, and other non-relational state remain bound by the
canonical common-state BLOB without being duplicated into unneeded columns.

Legacy operation loading is also complete without expanding the public
baseline state. Before either paired write, the stage executes one fixed,
main-schema-qualified lookup by canonical `(tenant_id,operation_id)` against
`main.ge_cycle_operations`. It requires exactly one retained row, rechecks
operation name, request hash, result hash, commit time, 2..16 MiB raw bounds,
and raw SHA-256, then decodes and byte-identically re-encodes through the
operation codec and recomputes the logical canonical hash. TEMP-table shadowing
cannot substitute the source carrier.

The nine legacy results map into one closed 30-column nullable discriminator:

- append binds existing tail sequence/hash and appended count;
- save-checkpoint binds its eight summary scalars;
- delete-checkpoint binds the exact boolean;
- acquire/renew lease bind identity, equal epoch/fence and exact acquired/
  expiry epoch milliseconds;
- release lease binds released status and equal high-water epoch/fence;
- acquire migration lock binds identity, forward versions, equal epoch/fence
  and exact acquired/expiry milliseconds; and
- set-legal-hold and release-migration-lock intentionally leave all derived
  columns null because their full results have no normalized recoverable
  carrier and remain bound only by the verified hashes.

Timestamp conversion rejects negative or unsafe epoch values and lexically
rejects any nonzero precision beyond milliseconds before the host date parser
can truncate it. Both runtimes test all nine complete 38-column legacy rows,
all thirty selected/null derived positions, offset/millisecond values,
all-null branches, main-vs-TEMP shadowing, missing/corrupt carriers, and
sub-millisecond attacks.

The paired lifecycle is fail-closed. Projection and legacy source proof happen
before the common write. If common insertion fails the stage poisons with no
relation row. If the relation insertion fails, the already successful common
row is retained as evidence, the stage becomes permanently poisoned, and the
caller must roll back. External DML between the two owned writes, duplicate
common/relation/natural identities, wrong relation routing, spoofed zero-row
effects, and retry-after-poison are hostile failures. Count and bidirectional
coverage barriers now recheck the write fence after their final read so DML
injected during the last SELECT cannot escape until a later call.

Checkpoint evidence is TypeScript SQLite 15 files / 155 tests, with 33 focused
stage tests plus typecheck, lint and build; Python 1,263 full tests, with 54
focused stage tests plus Ruff and strict MyPy over the changed modules/tests;
the complete SQLite ledger/reconciliation/migration contract remains 19 tests;
documentation links remain 286; and scoped `git diff --check` is clean. Final
cross-runtime hostile review reported HIGH 0, MEDIUM 0, and LOW 0 for this
bounded standalone stage/writer slice.

This checkpoint is not source-to-stage integration evidence. No production
scanner or reconciler invokes the paired API. The existing source generator
intentionally freezes `total_changes`; after one owned TEMP pair advances it by
two, a naive generator resume rejects the change. That guard remains unchanged
and must not be globally weakened.

### 31.34.25 Cooperative streaming allowance design gate

Before implementing §31.34.22, freeze one module-private cooperation contract
between the source reader and stage owner. It must satisfy all of the following:

1. The source owns statement order, one-row fetch bounds, family counts,
   initial EXCLUSIVE epoch and its last accepted total-change value.
2. The stage owns the only relation-write capability and returns an
   unforgeable receipt containing the same connection identity, transaction
   epoch, source item identity, before count, exact `+2` after count, and a
   single-use sequence number. No public raw connection or arbitrary delta is
   accepted.
3. The source may advance its expected count only by consuming the next exact
   receipt immediately after yielding/handing off that same item. Wrong
   connection, epoch, item, sequence, before/after count, reuse, omission,
   reordering, or delta other than two poisons both sides.
4. Caller DML before common, between common/relation, after relation/before
   receipt, during receipt validation, and between source fetches remains
   distinguishable from the two owned writes and fails closed.
5. Source statement finalization happens on normal completion, writer failure,
   caller exception, early abandonment and disposal. The contract may retain
   only the current entry/receipt; it cannot accumulate source entries or
   receipts.

Implement this first with 12 and 1,024 mixed-kind rows, then adversarially
review it before connecting the full source iterator. Required attacks include
forged delta, skipped receipt, duplicate receipt, receipt from another stage,
rollback/rebegin, savepoint epoch, prepared/trusted DDL, injected DML at every
boundary, relation failure after common, early generator close, and legacy
carrier mutation between capture and paired projection. Only after this gate
is green may §31.34.22 claim a real nonempty source-to-stage stream.

### 31.34.26 Cooperative source-to-stage streaming checkpoint

The §31.34.25 gate is now implemented and adversarially closed in both native
runtimes. The production v1 source iterator can stream directly into the
paired FILE-backed TEMP relation stage without materializing the source set
and without relaxing the public iterator's frozen `total_changes` guard. This
is the first checkpoint that may claim a real nonempty source-to-stage stream;
it remains an internal pre-migration primitive and is not exported from the
TypeScript or Python package root.

The required lifecycle is enforced in this exact order:

1. configure and read back the bounded FILE-backed TEMP profile outside a
   transaction;
2. begin one caller-owned `EXCLUSIVE` transaction;
3. create and validate the empty TEMP common/relation catalog;
4. capture the v1 source summary after stage DDL establishes its final epoch;
5. bind one lane to the exact connection, epoch, initial total-change value,
   empty common and relation counts, sequence zero, unused source iterator,
   open stage and absent pending receipt;
6. repeat one-row source fetch, canonical validation, common `+1`, matched
   relation `+1`, receipt issue, receipt consumption and independent source
   fence; and
7. prove terminal sequence/count equality, grouped common counts and
   bidirectional key coverage.

Each handoff retains only the current canonical source item and one opaque
receipt. The receipt is bound to the exact connection object, transaction
epoch, source item identity, stage-private session or pending-object identity,
monotonic sequence, before count and safe exact `after = before + 2` count. A
real receipt is single-use. Missing, forged, replayed, skipped, cross-stage,
wrong-entry, wrong-sequence, wrong-before, wrong-after or wrong-epoch evidence
is terminal; pending evidence is burned and cannot be retried. Standalone
common or paired writes cannot enter a cooperative lane while a receipt is
pending or after the stream completes.

The source advances its private expected write count only after the stage has
independently re-read its write fence, consumed the exact pending receipt and
returned the accepted count. The source independently re-reads
`total_changes` before fetching another row. DML before common, between common
and relation, after relation and before receipt, during receipt validation, or
between source fetches cannot be mistaken for either owned write. A relation
failure retains the successful common `+1` as rollback evidence and poisons
the lane. Legacy projection still re-reads the exact main-schema carrier
before either write, so a mutation after source yield is rejected without a
legacy TEMP relation row.

Completion, writer or receipt failure, caller exception, early generator
close, rollback/rebegin, savepoint or DDL epoch change all finalize the active
source statement and poison incomplete owners. Cleanup is best-effort but may
not replace the authoritative failure. TypeScript handles the special
`Generator.return()` rule by raising skipped-receipt failure from `finally`;
Python suppresses secondary cursor/source/stage cleanup failures before a bare
re-raise of the primary error.

The hostile matrix explicitly covers lifecycle reversal; nonempty stage and
lane mixing; wrong connection, epoch, item, stage, sequence, before and after
bindings; missing, forged, replayed, skipped and foreign receipts; rollback /
rebegin; SAVEPOINT; prepared and trusted DDL; all five external-DML timing
boundaries; relation failure with exact `+1` evidence; legacy carrier
mutation; early close and cursor finalization; and cleanup that must not mask
the primary failure. One real fixture exercises all twelve source kinds. A
second streams exactly 1,024 mixed entries with exactly 2,048 TEMP row changes
and bounded one-row source fetches.

Checkpoint evidence is TypeScript SQLite 16 files / 172 tests, including 17
focused reconciliation tests, plus typecheck, lint and build; Python 1,289
full tests, including 26 focused cooperation tests and 122 combined source /
stage / cooperation tests, plus Ruff and strict MyPy; the SQLite ledger /
reconciliation / migration contract remains 19 tests and reports
`implementationClaim:false`; documentation link validation remains 286;
scoped diff checks are clean. Final independent review reported HIGH 0,
MEDIUM 0 and LOW 0.

This checkpoint does not execute migration `0002`, write permanent v2 rows,
run a relational invariant rule, create or rebind a cursor, seal a projection
root, publish runtime schema v2, prove 100,000-entry behavior, perform crash
recovery/replay, select a release candidate, or establish adoption/star
outcomes. Those claims remain false.

### 31.34.27 Ordered TEMP handoff and first invariant campaign next slice

The next slice shall add the one-shot ordered reader over the verified TEMP
stage. It must read `ORDER BY kind_rank,key_blob`, revalidate canonical bytes
and epoch at every boundary, append into the constant-memory accumulator,
prove the exact projection identity/root, and finalize on success, error,
early close or stage disposal. A second iteration, missing/extra/reordered
row, catalog replacement, unexplained DML, source/stage count mismatch or
post-coverage mutation must poison the handoff and require rollback.

Only after that ordered handoff is green may the first stream/record invariant
campaign execute. It must cover missing stream ownership, persisted-empty
sentinel violations, sequence gaps, predecessor mismatch, tail mismatch,
record hash/value carrier drift and duplicate natural hashes using bounded
indexed existence/count queries. Query plans must prove named relation-index
use, diagnostics must use registered safe `BLR_*` IDs, and TypeScript/Python
fixtures and outcomes must remain deeply equal. Migration `0002`, permanent
publication, cursor rebind, later invariant families, 100K, crash/replay,
release and adoption remain later append-only checkpoints.

### 31.34.28 Verified ordered TEMP handoff checkpoint

The ordered handoff portion of §31.34.27 is now implemented and independently
closed in TypeScript and Python. After a successful cooperative source load,
one private stage-owned capability reads the verified common TEMP table in
exact `kind_rank ASC, key_blob ASC` order. Rank is numeric and the key is a
SQLite BLOB, so the ordering is unsigned binary byte order; decoded JSON,
text collation, kind spelling, cast order and caller-provided order are never
trusted.

The handoff is bound to the exact cooperative completion, source summary
object, stage session, owner connection, `EXCLUSIVE` epoch, expected write
counter, expected entry count, empty pending receipt, complete twelve-kind
count vector and validated common/relation catalog. A stage cannot begin the
reader before the cooperative stream's terminal receipt has been consumed.
Another summary with identical scalar fields, a stage from another connection,
a second reader, a second handoff, standalone writes, rollback/rebegin,
SAVEPOINT, prepared/trusted DDL or catalog replacement is terminal.

The row stream is constant-space. It owns one cursor, one current row, the
existing constant-memory accumulator, the preceding sort key and twelve fixed
integer counters. TypeScript uses the synchronous SQLite iterator; Python uses
only `fetchone()` and explicitly rejects any need for `fetchmany()` or a row
collection. For every row, both runtimes fence owner/epoch/write count before
and after the fetch, validate the exact four-column shape, require rank/kind
agreement, decode the key and state, re-encode them canonically, require exact
byte identity, append them to the accumulator, discard the returned entry and
fence again before requesting the next row.

EOF is not success by itself. The observed total and all twelve consumed kind
counts must equal the exact source summary. Grouped common counts,
bidirectional relation-key coverage, reserved catalog identity and
STRICT/WITHOUT ROWID table shape are re-proved. The accumulator then seals the
projection identity, a post-root write fence runs, and only then may the stage
publish handoff completion. The returned value contains only the frozen
baseline/projection identity; no entry array, source row or raw payload is
returned or retained.

Cursor lifecycle is fail-closed. Normal EOF, recapture failure, ordering or
count failure, early reader close, caller exception, stage disposal and owner
transaction failure synchronously finalize the active cursor. Cleanup cannot
mask an authoritative read/root failure. When no primary error exists, a row
cursor or catalog cursor close failure is surfaced and poisons the stage.
Disposal still performs best-effort reverse TEMP cleanup and reports its first
authoritative cleanup failure; a stale stage never deletes replacement
objects from a later epoch.

The hostile matrix covers missing, extra, duplicate, reordered, rank/kind
swapped, noncanonical and equal-total cross-kind substituted rows;
count-preserving real DML; DML after fetch, validation, accumulator append,
EOF, terminal catalog proof, root seal and completion; wrong source/summary /
stage/connection; exact-shape summary replacement; catalog and transaction
replacement; direct early close; repeated iteration; active-reader disposal;
cursor-close failure with and without a primary; and cleanup-primary
preservation. Exact twelve-kind and 1,024-entry streams match the existing
materializing builder. Both runtimes also match one literal pristine
three-entry golden: baseline `v2-57ddf582...f3612`, first entry
`bfb3045f...5928`, final entry `1ad91f22...2e06`, projection
`7d9dc721...e245`, count three and legacy count zero.

Checkpoint evidence is TypeScript SQLite 16 files / 199 tests, with 44 focused
cooperation/handoff tests, typecheck, lint and build; Python 1,317 full tests,
with 28 focused handoff and 150 combined source/stage/cooperation/handoff
tests, plus full Ruff and strict MyPy; ledger/reconciliation/migration
contract 19; documentation links 286; scoped diff checks clean. Final
cross-runtime audit reports HIGH 0, MEDIUM 0 and LOW 0.

This checkpoint proves a projection identity/root in TEMP but does not persist
that root, create a cursor seal, run a registered relational invariant, execute
`0002`, write a permanent v2 baseline row, publish schema v2, prove 100,000
entries, perform crash recovery/replay, select a release candidate, or establish
adoption/star outcomes. Every such claim remains false.

### 31.34.29 Stream/record relational invariant campaign implementation gate

The next slice shall implement only the first registered invariant family over
the verified normalized TEMP relations. Before coding, resolve the exact
existing `BLR_*` registry IDs for stream existence, empty-stream sentinel,
record sequence, predecessor, tail and hash/value identity; if a required
diagnostic does not exist, append it to the frozen registry and regenerate its
contract evidence before runtime use. No runtime branch may invent a free-form
or tenant-bearing error.

Queries must be fixed, bounded and index-audited. The campaign shall prove:

1. every record references exactly one normalized stream in the same tenant;
2. a persisted empty stream has tail sequence `-1` and null tail hash, while a
   nonempty stream has a nonnegative tail and nonnull hash;
3. record sequences start at zero and form a contiguous range per
   `(tenant_id,stream_id)` without gaps or duplicates;
4. sequence zero has a null predecessor and each later record's predecessor
   equals the prior sequence's record hash;
5. the stream tail sequence/hash equals its final record exactly;
6. normalized record identity, natural tenant/hash uniqueness and stored
   canonical state remain mutually consistent; and
7. no orphan, cross-tenant alias, count-preserving replacement or relation /
   common disagreement survives the final barrier.

Each query must have a capped witness count or existence result, safe stable
diagnostic output and pre/post owner/write/catalog fences. `EXPLAIN QUERY PLAN`
tests must prove use of the named record tenant-hash, stream-sequence and
stream-position indexes; an accidental full scan of the record carrier is a
test failure unless the query is the explicitly bounded global aggregate.
TypeScript and Python must share exact happy/hostile fixtures, diagnostic IDs,
rule order and outcome counts. Required attacks include missing stream,
foreign-tenant stream, persisted empty-stream record, first sequence not zero,
interior and terminal gaps, null/nonnull predecessor inversion, predecessor
hash mismatch, stale tail, wrong tail hash, duplicate tenant/hash identity,
common-only/relation-only rows, DML during every rule boundary, catalog
replacement, early abort and cleanup failure.

The campaign remains read-only over TEMP and returns a bounded frozen rule
report tied to the already sealed projection identity. It cannot update,
delete, repair, quarantine or compensate a finding. Checkpoint/lease/lock /
hold/legacy rules, cursor seal and persistence, `0002`, crash/replay, 100K,
release and adoption remain separate later slices.

### 31.34.30 Verified stream/record relational invariant checkpoint

The first registered relational campaign from §31.34.29 is now implemented,
cross-runtime matched and independently adversarially closed. It remains a
module-private pre-migration capability. It can begin only after the exact
cooperative source stream and ordered TEMP handoff have completed, and it
returns only a frozen report tied by object identity to that already sealed
projection. No package-root API, migration, repair path or permanent write was
introduced.

The reconciliation registry now contains 54 ordered rules. The stream/record
phase contains these exact seven IDs in this exact order:

1. `BLR_RECORD_STREAM_MISSING`;
2. `BLR_STREAM_EMPTY`;
3. `BLR_RECORD_GAP`;
4. `BLR_RECORD_PREDECESSOR`;
5. `BLR_STREAM_TAIL`;
6. `BLR_RECORD_HASH_DUPLICATE`; and
7. `BLR_RECORD_BINDING`.

`BLR_RECORD_BINDING` was added because natural-hash duplication and canonical
common/relation disagreement are different failure domains. The new rule
binds both directions of the rank-three common-stage carrier to the normalized
record relation and compares tenant, stream, record ID, sequence,
predecessor/record/value hashes, value length and committed clock. It does not
overload `BLR_RECORD_HASH_DUPLICATE`, and no implementation branch invents a
free-form diagnostic ID.

All seven queries are fixed source constants rather than caller-composed SQL.
They return only the integer witness marker `1`, accept exactly one bounded
`LIMIT` binding and consume at most `diagnosticLimit + 1` rows. The default
limit is 16, the maximum is 64, and exact-limit versus limit-plus-one behavior
is tested at 1, 16 and 64. Only nonzero rules enter the report. A diagnostic
contains exactly `ruleId`, capped `violationCount` and
`diagnosticsTruncated`; it contains no SQL, tenant, stream, record, key BLOB,
state BLOB, witness, message or payload.

Query topology is frozen and plan-audited. Record ownership and gap scans use
`ge_blr_records_stream_sequence_uidx`; predecessor joins and exact/later-tail
lookups use `ge_blr_records_stream_position_idx`; natural-hash and binding
scans use `ge_blr_records_tenant_hash_uidx`. The persisted-empty query scans
only streams and cannot accidentally scan the record carrier. The tail rule
checks the declared position/hash and also rejects a matching but stale tail
when any later sequence exists. This latter branch was retained after an
independent audit constructed records `0/A,1/B` with a declared `0/A` tail,
which would otherwise evade the gap, predecessor and exact-position checks.

The campaign capability is bound to the exact owner connection, live
`EXCLUSIVE` epoch, sealed projection object, ordered-handoff session, entry
count, twelve-kind expected-count vector, write counter and reserved TEMP
catalog. An equal-content projection clone is not authority. Every prepare,
cursor registration, fetch, close, diagnostic append, rule transition and
terminal completion has pre/post owner, write, epoch and catalog fences. The
terminal barrier re-proves total common/relation counts, all twelve per-kind
common counts, bidirectional relation-key coverage and exact catalog shape
before publishing success.

The report is one-shot. A second run, an equal-shape identity replacement,
early abandonment, DML, rollback/rebegin, savepoint/DDL epoch drift, catalog
replacement or incomplete cleanup permanently poisons the lane and requires
caller rollback. The active witness cursor is stage-owned while a rule is
open. Normal EOF, witness validation failure, query failure, campaign abort,
stage disposal and catalog/transaction failure all finalize it exactly once.
A cleanup error cannot replace an authoritative query/fence failure; when no
primary exists, cursor cleanup failure is surfaced after best-effort removal
of every owned TEMP object.

The shared TypeScript/Python hostile fixture is literal, not mocked. Both
runtimes use captured time `1785110405000`, produce the same 21-entry
projection (`baselineId` prefix `v2-fa4f8ccf`, first hash `f061b7d1`, final
hash `f1210fc0`, projection hash `8ad73854`) and return ordered counts
`1/2/2/1/3` for missing stream, persisted empty stream, first/interior gaps,
predecessor drift and stale/missing/wrong tail. It includes a foreign-tenant
same-stream alias, an explicit empty stream, first-sequence and interior gaps,
a wrong predecessor, a matching-but-behind tail, a missing tail position and
a wrong tail hash. Binding replacement, common-only/relation-only coverage,
defensive duplicate-hash witness, malformed witness marker and exact safe
envelope behavior are separately tested.

The hostile lifecycle matrix injects DML after cursor creation for every one
of the seven rules, during fetch, during close, after diagnostic append and at
terminal completion. It also replaces the catalog during a rule, exercises
closed options including null/array/accessor/non-enumerable/symbol carriers,
proves hostile accessors are never evaluated, disposes an active campaign and
combines fetch-primary with cleanup-secondary failures. The two runtime test
suites assert the same rule order, SQL limits, named-index plans, literal
projection identity and diagnostic outcome.

Checkpoint evidence is TypeScript SQLite 16 files / 232 tests, including 77
focused reconciliation tests, plus typecheck, lint and build; Python 1,356
full tests, including 39 focused campaign tests and 204 related source/stage /
cooperation/handoff/campaign tests, plus Ruff and strict MyPy; the complete
SQLite ledger/reconciliation/migration contract remains 19 tests and the
registry validator reports 54 rules with `implementationClaim:false`;
documentation links remain 286; diff checks are clean. Final independent
review reports HIGH 0, MEDIUM 0 and LOW 0.

This checkpoint does not run checkpoint, lease, lock, hold or legacy
relational campaigns; create or persist a cursor seal/root; execute migration
`0002`; publish runtime schema v2; prove 100,000-entry behavior; perform
crash/replay recovery; select a release candidate; or establish adoption or
star outcomes. All such claims remain false.

### 31.34.31 Checkpoint relational invariant campaign implementation gate

The next bounded slice shall implement only the six registered checkpoint
rules over the already verified TEMP relations. It must reuse the exact sealed
projection/session/cursor ownership machinery established by §31.34.30 rather
than create a parallel unbound reader. Before implementation, freeze one
shared TypeScript/Python query table in this exact registry order:

1. `BLR_CHECKPOINT_REVISION_GAP`;
2. `BLR_CHECKPOINT_RECORD_MISSING`;
3. `BLR_CHECKPOINT_CURRENT_MISSING`;
4. `BLR_CHECKPOINT_CURRENT_UNEXPECTED`;
5. `BLR_CHECKPOINT_CURRENT_STALE`; and
6. `BLR_CHECKPOINT_CURRENT_BINDING`.

The revision-gap rule shall group by tenant and checkpoint scope, require a
contiguous revision domain beginning at one, and reject duplicate or missing
positions without collecting revision histories. Put revisions must bind to
one exact record by tenant, stream, sequence and record hash. The latest
revision per `(tenant,scope,checkpointId)` must deterministically drive current
state: latest put requires exactly one equal current row; latest delete
requires current absence; a non-latest put/delete must never override a later
revision. The binding rule must compare normalized current/revision scalars to
their canonical rank-four/rank-five common-stage key and state carriers in both
directions.

Each query must use a fixed `LIMIT diagnosticLimit + 1` witness boundary and
return only marker rows. `EXPLAIN QUERY PLAN` tests must prove the named
checkpoint-current record index, checkpoint-revision latest index and
checkpoint-revision record index wherever applicable. Any unavoidable grouped
revision scan must be explicitly named in the test and must not introduce a
per-checkpoint query, an N+1 loop, `.all()`, `fetchall()` or an unbounded
history collection.

The first shared hostile fixture must include: revision starting at two;
interior revision loss; two checkpoint IDs interleaved in one scope; put bound
to a missing record; put bound to the right sequence but wrong hash; latest put
with missing current; latest delete with unexpected current; current row from
an older put; current row with substituted checkpoint ID, stream, revision,
created timestamp, value hash, value length or committed clock; common-only
and relation-only rank-four/rank-five rows; and a cross-tenant record alias.
Both runtimes must hard-code one identical projection identity and one exact
ordered diagnostic count vector from that fixture.

The lifecycle matrix must repeat all seven boundary classes already closed for
stream/record rules: per-rule cursor creation, fetch, close, post-diagnostic,
rule transition, mid-rule catalog replacement and terminal barrier. Add
latest-revision-specific attacks for equal-count row substitution, delete /
recreate, ambiguous maxima, stale index replacement and current mutation after
the latest row was read. Exact-limit and limit-plus-one tests remain required
at 1, 16 and 64; malformed markers and cleanup-primary precedence remain
release blockers.

The slice is complete only when TypeScript/Python queries, plans, fixture
identity, diagnostic order/counts and poison behavior are equal; focused and
full suites, typecheck, lint, build, Ruff, strict MyPy, the 19-test SQLite
contract, 54-rule registry validation, documentation links and diff checks all
pass; and an independent adversarial review reports HIGH 0 / MEDIUM 0 / LOW 0.
It must then append a truthful completion checkpoint and the next
lease/lock/hold gate. It still may not create permanent v2 rows, run `0002`,
persist a cursor seal/root, claim 100K/crash/release closure or claim adoption
or star results.

### 31.34.32 Verified checkpoint relational invariant checkpoint

The six-rule checkpoint campaign required by §31.34.31 is now implemented in
both native runtimes. The TypeScript and Python implementations are private to
their SQLite baseline packages, enter only after the same ordered TEMP handoff
and stream/record campaign have completed, and bind to the exact projection
object, owner connection, exclusive transaction epoch, source summary, write
counter, twelve-kind counts, bidirectional common/relation coverage and exact
TEMP catalog. No public package export was added.

The fixed registry order is exactly revision gap, record missing, current
missing, current unexpected, current stale and current binding. Every query
returns marker rows only and is bounded by `diagnosticLimit + 1`; the report is
the frozen projection identity plus safe `ruleId`, `violationCount` and
`truncated` fields. Option validation is closed and occurs before campaign
ownership is burned. The default limit is 16, the maximum is 64, and exact and
overflow boundaries at 1, 16 and 64 are executable tests in both runtimes.

The revision-gap violation unit is one `(tenantId,checkpointScope)` revision
domain and rejects both a start above one and an interior hole using a single
grouped scan. Record binding separately audits current carriers and put
revision carriers against the exact tenant, stream, sequence and record hash.
Latest revision selection is partitioned by tenant, scope and checkpoint ID:
latest put requires current, latest delete forbids current, zero-history
current is unexpected, and a current revision behind the latest put is stale.
The binding query has four mutually exclusive branches covering normalized
current-to-common plus current-to-latest-put equality, rank-four common without
current, revision-to-rank-five common equality and rank-five common without a
revision. It checks every top-level and eight-field summary carrier, requires a
JSON null summary for delete revisions, and binds current committed time to the
latest put's recorded time.

The query plans are asserted against the checkpoint-current record,
checkpoint-revision record, checkpoint-revision latest and record stream
position indexes wherever each relation permits it. There is no per-item or
per-checkpoint query, `.all()`, `fetchall()` or collected history in production
code. One stage-owned cursor is live at most; creation, fetch, close,
post-diagnostic, rule transition, catalog replacement and terminal completion
are fenced. Disposal closes an active cursor, the authoritative query/fence
failure remains primary over cleanup failure, one-shot and abandoned runs
poison the stage, and completion re-proves counts, coverage, catalog, session,
projection and transaction ownership.

Both runtimes share one literal 43-entry hostile fixture at capture time
`1785110405000`. Its baseline, first-entry, final-entry and projection digests
are respectively
`v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af`,
`f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c`,
`c4585a6a22dd0859d5d671f75ff143a6c5eae088cc3d87a2addc97ce9c21144c`
and `264a8ba16682d78368f5318e67b2c938167a28549ccf8fbb1ca685d2f79f497e`.
Its exact ordered diagnostic vector is `2/3/2/2/1/1`. The fixture and isolated
real-SQL mutations cover a start at revision two, an interior gap, interleaved
checkpoint IDs, cross-tenant record aliases, wrong record hashes, missing and
unexpected current rows, zero-history current, stale current, field-by-field
rank-four/rank-five drift, multiple simultaneous field drift, delete-summary
drift and clock-only drift.

The §31.34.31 common-only and relation-only attacks are intentionally rejected
at campaign begin rather than admitted into the diagnostic fixture: exact
bidirectional stage coverage is a predecessor safety fence. Tests mutate both
directions while preserving total counts and prove that the campaign fails
closed before it can issue a misleading partial report. Weakening this fence
merely to count an already-invalid stage would contradict the sealed handoff
contract; therefore these attacks are covered at the earlier and stronger
boundary.

Final evidence is TypeScript checkpoint-focused 45 tests and SQLite 16 files /
277 tests, plus typecheck, lint and build; Python checkpoint-focused 57 tests,
261 adjacent baseline tests and 1,413 full tests, plus Ruff and strict MyPy;
the SQLite ledger/reconciliation/migration contract is 19/19, registry
validation reports exactly 54 rules with `implementationClaim:false`, docs
check 286 local Markdown links and diff checks are clean. Two independent
reviews, including direct execution of production SQL against a separately
built TEMP model, report HIGH 0, MEDIUM 0 and LOW 0.

This checkpoint does not implement the lease/lock/hold, legacy, cursor or
clock campaigns; execute migration `0002`; write permanent schema-v2 rows;
persist a cursor seal or projection root; prove 100,000-entry memory behavior;
prove crash/replay recovery; select a release candidate; or establish adoption
or star results. Those claims remain explicitly false.

### 31.34.33 Lease, migration-lock and legal-hold invariant campaign gate

The next bounded slice shall implement only the six registry rules in the
`lease-lock-hold` phase, in this exact order:

1. `BLR_LEASE_STREAM_MISSING`;
2. `BLR_LEASE_HISTORY_INCOMPLETE`;
3. `BLR_LEASE_ACTIVE_BINDING`;
4. `BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE`;
5. `BLR_MIGRATION_LOCK_ACTIVE_BINDING`; and
6. `BLR_HOLD_STREAM_MISSING`.

It must extend the same private, one-shot campaign chain after successful
checkpoint completion. Entry requires the exact sealed projection reference,
source summary, owner connection, exclusive epoch, unchanged total-change
counter, expected per-kind counts, common/relation coverage and exact catalog.
It may not reopen source input, materialize the projection, create an
independent connection or accept a structurally equal replacement identity.
Completion must repeat every binding and fence and leave a distinct completed
phase that is required by the later legacy campaign.

Before coding, freeze one identical TypeScript/Python rule table, marker shape,
diagnostic envelope, default/max limit and query-plan expectation. All queries
must be fixed SQL with one bounded `LIMIT diagnosticLimit + 1`; production
iteration must use single-row fetches and retain no identity, history or
payload collection. Each rule's violation unit must be written into the test
contract before the shared hostile fixture is finalized. If an additional
index is genuinely necessary, it must first be justified by equal query plans
and bounded-memory behavior in both runtimes; otherwise use the existing
primary keys and relation tables without altering the frozen schema contract.

`BLR_LEASE_STREAM_MISSING` shall report one lease-current row whose exact
tenant/stream pair has no stream. `BLR_HOLD_STREAM_MISSING` shall independently
report one legal hold whose exact tenant/stream pair has no stream; a stream in
another tenant is never an alias. Both must test empty and nonempty valid
streams, multiple holds on one stream and a cross-tenant same-name stream.

`BLR_LEASE_HISTORY_INCOMPLETE` shall define and prove the complete epoch domain
from one through `lastLeaseEpoch` using used-lease identities plus the active
lease when present. The design must reject a start above one, interior gaps,
duplicate epoch/fencing-token ownership, epochs beyond the high-water and an
inactive current whose high-water lacks its terminal used identity. It must
not mistake distinct lease IDs for distinct epochs or allow another tenant or
stream to fill a hole. The final SQL shape must count one violation per exact
tenant/stream domain and handle the legal zero high-water state without a
synthetic history row.

`BLR_LEASE_ACTIVE_BINDING` shall compare the lease-current relation to its
rank-six canonical common entry in both directions and, when active, require
the active lease ID to own the same tenant, stream, epoch and fencing token
expected by the current high-water semantics. It must bind holder ID,
acquisition time, expiry, last epoch/token and updated time to their canonical
state fields; preserve the all-null inactive tuple; require expiry after
acquisition; and ensure no used identity falsely substitutes for the active
identity. Field-by-field and multiple-field equal-count substitutions are
required real-SQL attacks.

`BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE` shall apply the same `1..lastLockEpoch`
domain proof to the singleton migration lock and used-lock identities. It must
cover zero high-water, first-epoch absence, interior loss, extra future epoch,
duplicate epoch/token ownership and active-terminal semantics without relying
on row order. `BLR_MIGRATION_LOCK_ACTIVE_BINDING` shall compare the singleton
rank-nine common entry and relation in both directions, require the active lock
ID/owner/source/target/epoch/token/acquisition/expiry fields to agree, preserve
the all-null inactive tuple, require target version greater than source,
require expiry after acquisition and bind updated time. Singleton absence,
multiple common candidates, substituted active ID, retired-ID reuse and
source/target reversal are isolated attacks.

The first shared hostile fixture must contain enough pristine rows to prove
valid zero, retired and active lease histories; valid inactive and active
migration-lock histories; valid legal holds; and tenant/stream isolation. It
must then add isolated witnesses for each of the six rule counts, including a
lease orphan, hold orphan, start and interior history gaps, extra epochs,
wrong active IDs, epoch/token substitutions, inactive/active null-tuple drift,
same-count common/relation substitutions, cross-tenant aliases and migration
version drift. Both runtimes must hard-code one identical capture time,
entry count, four projection identity values and exact six-number diagnostic
vector. Each rule also needs a direct minimal TEMP execution test so fixture
coincidence cannot conceal a branch error.

Repeat the complete hostile lifecycle matrix: mutation at each of six cursor
creation boundaries; during marker fetch; on close; after diagnostic emission;
between rules; during grouped-history evaluation; after the active row has
been observed; via table/index delete-recreate; and at terminal completion.
Include closed-option hidden, symbol and accessor keys before ownership burn,
malformed markers, limit/exact-limit/limit-plus-one at 1, 16 and 64, projection
clone, second run, abandonment, active disposal, cleanup-only failure and
primary-over-cleanup precedence. Count-preserving mutation must be rejected at
campaign begin, while in-campaign DML or catalog replacement must poison at
the nearest pre/post fence.

Completion requires semantically equal TypeScript/Python SQL, plans, report
freezing, fixture identity/vector, diagnostic order and poison behavior;
focused, adjacent and full tests; TypeScript typecheck/lint/build; Python Ruff
and strict MyPy; the 19-test SQLite contract and 54-rule registry validation;
286-link-or-later docs validation; clean scoped/full diff checks; and a fresh
independent adversarial review at HIGH 0 / MEDIUM 0 / LOW 0. The completion
checkpoint must truthfully enumerate evidence and append a separate legacy
campaign gate. It still may not run `0002`, write permanent v2 state, persist
cursor/projection seals, claim the clock or cursor phases, claim 100K/crash /
release closure, or claim adoption and star outcomes.

### 31.34.34 Verified lease, migration-lock and legal-hold checkpoint

The six-rule `lease-lock-hold` campaign required by §31.34.33 is now
implemented in both native runtimes. It is package-private, one-shot and
available only after the exact checkpoint campaign session has completed. Its
entry and terminal barriers retain the same projection-reference, source
summary, connection owner, exclusive epoch, write counter, twelve-kind count,
bidirectional common/relation coverage and exact TEMP catalog proofs. No public
package export or parallel reader path was introduced.

The fixed registry order is lease stream missing, lease history incomplete,
lease active binding, migration-lock history incomplete, migration-lock active
binding and hold stream missing. The TypeScript and Python rule tables are
whitespace-normalized token-for-token equal. Every rule returns marker rows
only, uses the same closed safe diagnostic envelope, and applies a fixed
`diagnosticLimit + 1` boundary with default 16 and maximum 64. Production code
performs single-row iteration, never `.all()`, `fetchall()` or application-side
history collection, and owns at most one cursor through the TEMP stage.

Lease histories are proved solely by the used-lease relation: for each exact
tenant/stream domain, count, minimum and maximum epochs plus explicit
epoch/fencing equality establish the complete `1..lastLeaseEpoch` domain under
the already catalog-verified unique epoch and fencing indexes. An active lease
does not add a second history epoch; instead, active binding requires the
terminal used identity to match tenant, stream, lease ID, epoch, fencing token
and acquisition/first-use clock. This closes the design ambiguity discovered
during adversarial review and matches the actual provider acquisition write.
Missing terminal history is counted only by the history rule; a present
terminal carrier with substituted ID or clock is counted only by active
binding.

Migration-lock history applies the same proof to the mandatory singleton and
global used-lock identities. Active binding additionally requires the exact
lock ID, owner, source/target versions, epoch, fence, acquisition, expiry and
first-use clock; target must advance source. Lease and lock active tuples are
explicitly all-null or all-present, epoch/fence/high-water equality is checked
even under ignored CHECK constraints, expiry must follow acquisition and
negative high-water values are rejected.

Because the registry has no separate rank-seven, rank-eight or rank-ten
binding IDs, the campaign closes those carriers within the existing six
rules. Lease history binds every used-lease key and six state fields to
rank-seven common entries in both directions; lock history binds every
used-lock key and four state fields to rank ten; hold stream missing binds
every hold key and four state fields to rank eight while also requiring the
exact tenant/stream to exist. Active binding similarly checks every rank-six
and rank-nine key/state field in both directions. One lease-history diagnostic
unit is one tenant/stream domain even if several carriers drift, and each lock
history/active rule emits at most one singleton witness.

The final query topology has no `MATERIALIZE`, automatic index or
`count(DISTINCT)` history barrier. Correlated aggregates use the named lease or
lock epoch indexes. Migration-lock rules require no TEMP sort; lease history
has exactly one FILE-backed outer group to normalize all anomaly branches to
one tenant/stream unit. Query-plan tests freeze those facts and reject any
additional TEMP B-tree. No new schema object was required.

Both runtimes share one literal 46-entry hostile fixture at capture time
`1785110405000`. It includes complete valid zero, retired and active lease
controls; nonempty stream/record tails; two valid holds on one stream; a
cross-tenant alias; start, interior and extra lease-history faults; wrong
active ID and first-use clock; one active lock with history and terminal
binding faults; and an orphan hold. Its baseline, first-entry, final-entry and
projection identities are respectively
`v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af`,
`f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c`,
`6b929039b709ef0a09818896df9d0366564389219e7fbec1866648bd67684638`
and `ebc3aab7adc7062aee8067e2bbada04d14f0502802f1241dd62b2a790eb9e755`.
The exact ordered diagnostic vector is `1/3/2/1/1/1`.

The hostile matrix executes all rank-six through rank-ten key fields and 37
state fields against production SQL, including multiple simultaneous drift,
first-use clocks, active-present and inactive null tuples, expiry inversion,
negative high-water, version reversal, singleton absence and domain collapse.
It also proves limits 1/16/64, malformed markers, identity clones, one-shot and
abandoned runs, per-rule creation/fetch/close mutations, post-diagnostic and
rule-transition mutation, grouped-history and active-witness boundaries,
terminal completion, active disposal, cleanup-only failure and primary-over-
cleanup precedence. Table and index drop/recreate, count-preserving coverage
mutation, retired-ID reuse, duplicate epoch/fence ownership, multiple
singleton/common candidates and empty-stream behavior are explicitly tested.

Some attacks cannot enter a successful campaign: UNIQUE/PK/CHECK constraints
reject duplicate identities, partial active tuples and multiple singletons;
the exact coverage fence rejects common-only/relation-only candidates; and the
stream campaign rejects an empty persisted stream before lease/hold rules.
Those cases have explicit early-rejection tests plus direct production-SQL
defense where applicable. The singleton cannot be validly active and inactive
in one snapshot, so the shared fixture uses the active control while a separate
minimal fixture proves the inactive state. No safety fence was weakened to
manufacture a diagnostic.

Final evidence is TypeScript lease/lock/hold-focused 56 tests and SQLite 16
files / 333 tests, plus typecheck, lint and build; Python focused 138 tests,
399 adjacent baseline tests and 1,551 full tests, plus Ruff and strict MyPy
including the new test module; the SQLite contract is 19/19, registry
validation remains exactly 54 rules with `implementationClaim:false`, docs
check 286 links and diff checks are clean. Independent adversarial review and
main-thread reruns report HIGH 0, MEDIUM 0 and LOW 0.

This checkpoint does not implement legacy, cursor or clock campaigns; execute
migration `0002`; write permanent schema-v2 state; persist a projection root or
cursor seal; prove 100,000-entry behavior; prove crash/replay recovery; select
a release candidate; or establish adoption or star outcomes. Those claims
remain false.

### 31.34.35 Legacy recoverable-binding invariant campaign gate

The next bounded slice shall implement only the five rules in registry order:

1. `BLR_LEGACY_INVENTORY`;
2. `BLR_LEGACY_APPEND_BINDING`;
3. `BLR_LEGACY_CHECKPOINT_BINDING`;
4. `BLR_LEGACY_LEASE_BINDING`; and
5. `BLR_LEGACY_LOCK_BINDING`.

The private one-shot chain must begin only after successful lease/lock/hold
completion and inherit every exact identity, owner, transaction, write,
counts, coverage, catalog and cursor-cleanup fence. Completion must leave an
explicit legacy-complete phase required by the later cursor/clock work. It may
read only the already normalized rank-eleven relation/common carriers and
fixed physical v1 relations needed for recoverable result binding; it may not
decode result blobs again, retain them, reconstruct unavailable requests or
guess a stream/checkpoint/lease target not present in the captured result.

Before implementation, write a cross-runtime recoverability table for all
eight legacy mutation names: append, save/delete checkpoint, acquire/renew /
release lease, set legal hold, and acquire/release migration lock. For every
derived scalar, mark whether it is present in the canonical result, uniquely
bindable to physical state, only existentially bindable within the tenant, or
not recoverable. A rule must never strengthen an existential fact into a
fabricated identity. The table, not an informal prompt assumption, shall be
the source for fixed SQL and hostile expected counts.

`BLR_LEGACY_INVENTORY` shall bind each rank-eleven common key/state carrier and
normalized legacy relation in both directions, then bind tenant, operation ID,
operation name, request hash, result hash and commit clock to the exact v1
operation row. The result-blob SHA-256 was computed during bounded source
staging and is protected by the same write fence; this campaign must not load
the blob merely to recompute it. Inventory units are exact tenant/operation
identities and must detect operation insert/delete, name/hash/time drift,
common-only/relation-only rows and count-preserving key substitution.

`BLR_LEGACY_APPEND_BINDING` shall use only the append result's recoverable tail
existence, sequence, record hash and appended count. It must prove the exact
tenant-scoped physical tail/record facts that are uniquely derivable, document
and test any intentionally existential stream match, reject a missing or
foreign-tenant tail and never infer the original request stream. Multiple
candidate streams with the same recoverable result must follow one frozen,
safe diagnostic unit rather than nondeterministic selection.

`BLR_LEGACY_CHECKPOINT_BINDING` shall bind save-checkpoint results to the exact
tenant/scope/checkpoint/stream/sequence/hash/timestamp/value metadata carried
by the result. Delete results expose only the boolean and therefore must be
validated without inventing the deleted checkpoint request; `deleted:false`
and `deleted:true` need separate physical/recoverability tests. Older saves,
later deletes, cross-tenant aliases and recreated current checkpoints are
required attacks.

`BLR_LEGACY_LEASE_BINDING` shall bind acquire/renew results to the exact
tenant-scoped used lease identity by lease ID, epoch, fence and acquisition
clock and, only when still active, to equal holder/expiry/current state.
Release results carry status and high-water values but no recoverable stream
request; their rule must freeze the strongest tenant-scoped fact that can be
proved without guessing a stream. Retired IDs, later acquisitions, renewals,
same-tenant ambiguous histories and cross-tenant aliases must be isolated.

`BLR_LEGACY_LOCK_BINDING` shall bind acquire results to the global used-lock
identity and, when still active, its owner, source/target versions, epoch,
fence, acquisition and expiry state. Release-lock results are canonical null
and must not be assigned a fabricated prior lock ID. Tests must separate an
older retired lock from the current singleton, later acquisitions, release
after acquire, ID substitution, clock drift and version reversal.

All five rules must use fixed marker-only SQL with `diagnosticLimit + 1`, safe
three-field diagnostics, identical TypeScript/Python rule topology and no
result/request carrier in diagnostics. Query plans must use stable primary or
named indexes, contain no automatic index, unbounded materialization or
application collection, and explicitly justify the one grouped or existential
operation that cannot be a direct key lookup. Cross-rule branches must freeze
whether one corrupt legacy row may yield several rule diagnostics while never
yielding more than one witness per row per rule.

Build one literal shared fixture containing every legacy operation result plus
pristine and hostile physical states, hard-code one capture time, entry count,
four projection identities and exact five-number diagnostic vector, and add
minimal direct SQL fixtures for every branch. Repeat closed options, limits
1/16/64, malformed marker, exact projection reference, one-shot/abandonment,
per-five creation/fetch/close, post-diagnostic, rule transition, table/index
replacement, terminal, active disposal, cleanup-only and primary precedence.
Equal-count inventory mutation and main operation mutation after capture are
release blockers.

Completion requires focused, adjacent and full TypeScript/Python suites;
typecheck, lint, build, Ruff and strict MyPy including new tests; the 19-test
SQLite contract, 54-rule registry and docs/diff checks; exact normalized SQL,
fixture identity/vector and lifecycle parity; and a fresh independent review
at HIGH 0 / MEDIUM 0 / LOW 0. It must append a truthful completion checkpoint
and a separate cursor/clock gate. It still may not execute `0002`, write
permanent v2 state, persist seals, claim 100K/crash/release closure, or claim
adoption and star outcomes.

### 31.34.36 Evidence-precision correction for §31.34.34

This append-only note supersedes two overly broad evidence phrases in
§31.34.34 without changing the implementation or the §31.34.35 gate.

First, cursor-creation mutation is parameterized across all six rules in both
runtimes. Marker-fetch and cursor-close mutation are proven at representative
rules through the same shared executor loop; TypeScript additionally
parameterizes fetch across all six. The verified evidence must therefore be
read as “per-rule cursor creation, plus marker-fetch and close mutations,” not
as a claim that both fetch and close are separately parameterized over every
rule in both languages. The rule SQL, cursor owner and pre/post fences are
identical code paths after creation.

Second, a persisted empty stream is diagnosed by the preceding stream/record
campaign as `BLR_STREAM_EMPTY`, but that diagnostic report completes normally
and does not poison the stage. The subsequent checkpoint and lease/lock/hold
campaigns can therefore run. Lease and hold existence rules correctly treat
the empty stream row as present and do not duplicate the earlier diagnostic as
`*_STREAM_MISSING`. The empty-stream test proves this report-and-continue
behavior; it is not an early-rejection test. UNIQUE/PK/CHECK violations,
coverage disagreement and catalog replacement remain fail-closed predecessor
or physical-constraint rejections as originally stated.

After this evidence correction, the implementation/test review remains HIGH
0, MEDIUM 0 and LOW 0. No additional runtime, migration, release or popularity
claim is introduced.

### 31.34.37 Final Python suite-count correction

This append-only correction supersedes the Python full-suite count recorded in
§31.34.34. Seventeen final hostile tests were added after the earlier 1,551
snapshot. The final campaign-focused count is 138, the adjacent baseline count
is 399, and the complete Python suite is 1,568 tests plus two collected
subtests, all passing. Ruff and strict MyPy, including the new test module,
remain green. This is an evidence-count correction only; it does not change
the implementation, diagnostic vector, review severity or any nonclaim.

### 31.34.38 Canonical Python full-suite invocation correction

This final append-only correction supersedes §31.34.37. The authoritative
repository gate is exactly `cd python && uv run pytest -q`, with no repeated
path, overlapping selection or alternate subtest accounting. A main-thread
rerun after every staged implementation and test change reports exactly 1,551
passed tests. Focused remains 138 and adjacent baseline remains 399. The 1,568
plus two-subtest figure came from a noncanonical collection/accounting command
used during an auxiliary audit and must not be cited as the repository full
suite. Ruff and strict MyPy including the new test remain green. This corrects
evidence counting only; implementation, identities, diagnostics, review
severity and all nonclaims are unchanged.

### 31.34.39 Legacy gate recoverability correction

This append-only correction refines §31.34.35 before legacy implementation.
The closed mutation set contains nine operation names, not eight: append;
save/delete checkpoint; acquire/renew/release lease; set legal hold; and
acquire/release migration lock. The shared fixture and recoverability table
must cover all nine.

For append, tenant plus the result's tail sequence and record hash uniquely
locate the physical tail record under the already verified tenant/hash
constraint. The rule may then prove that the same physical stream contains
exactly `appendedRecords` positions in the inclusive range ending at that
sequence. It still must not require that this older result equals the current
stream head.

For acquire/renew lease, the only universally safe physical binding is a
tenant-scoped existential used identity with exact lease ID, epoch, fencing
token and `firstUsedAtMs == acquiredAt`. The request stream is unavailable;
different streams in one tenant may reuse the same ID/epoch-shaped values, and
a later valid renewal may extend the active expiry. Therefore §31.34.35's
phrase about equal holder/expiry/current state is superseded: the legacy rule
must not bind those current fields or select a guessed candidate stream.
Release results may prove only that some tenant lease domain has high-water at
least the returned epoch/fence; the preceding history campaign supplies the
complete used-identity guarantee.

These corrections narrow claims to recoverable facts and introduce no
implementation, migration, release or popularity claim.

### 31.34.40 Release-lease recoverability evidence correction

This append-only correction supersedes only the final release-lease sentence
of §31.34.39. Direct inspection of both production mutation paths proves that
every successful lease acquisition unconditionally inserts a durable
`ge_cycle_used_lease_ids` row at acquisition time. The row is not deferred
until the lease is used by append. A successful release therefore always has
a predecessor used-identity row for its returned epoch and fencing token.

The release binding must require a tenant-scoped used-lease row whose epoch and
fencing token exactly equal the returned `lastLeaseEpoch` and
`lastFencingToken`, join that row's tenant and stream to the corresponding
lease domain, and require both domain high-waters to be at least the returned
values. The result does not expose a stream ID or lease ID, so the rule must
not reconstruct or bind either one. This exact historical witness is stronger
than an arbitrary tenant high-water while remaining valid for acquire-then-
release flows with no intervening append.

The fixed TEMP catalog and index set remain unchanged for this gate. The
existing tenant-prefix traversal is bounded by the sealed TEMP projection and
must be covered by EQP/non-materialization evidence. This correction changes
no migration, public API, release, adoption or popularity claim.

### 31.34.41 Main operation-catalog identity fence correction

The legacy campaign cannot rely on transaction epoch, `total_changes()` and
the TEMP catalog alone to protect the result-blob digest captured during
staging. SQLite main-schema DDL changes `schema_version` without incrementing
`total_changes()`. An exact-shape shadow `ge_cycle_operations` table can be
prepared before capture and swapped into the canonical name with two renames
after staging; if every scalar and digest field except `result_blob` is copied,
an inventory query that intentionally does not reload the blob would otherwise
accept a source object different from the one that supplied the staged digest.

The TEMP-stage owner must therefore capture an immutable main-catalog receipt
before source staging. The receipt includes `main.schema_version` and the exact
`main.sqlite_schema` identity of `ge_cycle_operations`, including its table
type, canonical name, root page and stored SQL. Legacy begin and every legacy
fence around statement creation, marker fetch, close and rule transition must
reprove that receipt in addition to all prior transaction, write, projection,
counts, coverage and TEMP-catalog fences. A mismatch poisons the stage before
the result is accepted; the campaign still must not select, retain or decode
`result_blob`.

Both runtimes require an exact-shape shadow-swap hostile test whose replacement
preserves tenant, operation ID/name, request hash, result hash and commit clock
but substitutes the blob. The swap must leave `total_changes()` unchanged and
must nevertheless fail through the new main-catalog identity fence. Equivalent
table replacement during an active cursor and cleanup precedence remain part
of the lifecycle matrix. This correction adds no permanent schema object,
migration execution, public API, release, scale or popularity claim.

### 31.34.42 Frozen nine-operation legacy recoverability table

This append-only table completes the pre-implementation analysis required by
§31.34.35 and incorporates the corrections in §§31.34.39–31.34.41. Every
row states the strongest fact derivable from the canonical result without
recovering an unavailable request. An implementation that binds more strongly
than this table is invalid even if a convenient pristine fixture passes.

| Operation | Canonical result facts retained by rank eleven | Permitted physical proof | Explicitly unrecoverable or forbidden binding |
| --- | --- | --- | --- |
| `append` | tail exists, tail sequence, tail record hash, appended-record count | tenant plus record hash uniquely locates the physical tail record under the verified tenant/hash uniqueness constraint; its sequence must match; the same recovered stream must contain exactly the returned count in the inclusive contiguous range ending at the returned sequence | request stream, expected-tail precondition, record bodies and equality to the later current stream head |
| `save-checkpoint` | scope, checkpoint ID, stream ID, bound sequence/hash, creation clock, value hash/bytes | tenant-scoped existence of any exact `put` revision matching every retained result field | revision number, later current-checkpoint identity and an assumption that no valid delete/recreate followed |
| `delete-checkpoint` with `false` | only `deleted:false` | inventory and canonical result-shape proof; no physical absence fact is implied | requested scope/checkpoint target and global absence of checkpoints or revisions |
| `delete-checkpoint` with `true` | only `deleted:true` | tenant-scoped existence of at least one delete revision | requested scope/checkpoint target, exact deleted revision and current absence |
| `acquire-lease` | lease ID, holder, epoch, fence, acquired/expiry clocks | tenant-scoped used identity with exact lease ID, epoch, fence and first-used clock equal to acquired clock | request stream and binding holder/expiry to later current state |
| `renew-lease` | lease ID, holder, epoch, fence, original acquired clock, renewed expiry clock | the same exact tenant-scoped used identity proof as acquisition | request stream and historical proof of the returned renewed expiry after later renewal/release |
| `release-lease` | released status and last epoch/fence | tenant-scoped used row with exact returned epoch/fence joined through its own stream to a lease domain whose two high-waters are at least the result | lease ID, holder, request stream and selecting an arbitrary target stream from the result |
| `set-legal-hold` | canonical governance result retained in common state but no derived target column in the normalized relation | exact operation inventory only | request stream/hold target and reconstructing historical hold placement from the later snapshot |
| `acquire-migration-lock` | lock ID, owner, source/target versions, epoch, fence, acquired/expiry clocks | global used-lock identity exact on ID, epoch, fence and first-used/acquired clock; if and only if the current singleton still has the same active lock ID, every retained active field must also match | requiring current-active equality for a retired lock or treating later acquisition as corruption |
| `release-migration-lock` | canonical `null` | exact operation inventory only | prior lock ID, owner, versions, clocks or any inferred release target |

Inventory is separately bidirectional across the rank-eleven common carrier,
the normalized relation and the exact main operation row. Its three query
branches are mutually exclusive: relation-led disagreement, common-without-
relation, and exact-nine main row without either relation or matching common
key. The branches use `UNION ALL`; a distinct `UNION` and its TEMP B-tree are
forbidden. One tenant/operation identity can contribute at most one witness to
one rule, while independent rule families may each diagnose the same corrupt
operation when their contracts are independently violated.

### 31.34.43 Verified legacy recoverable-binding checkpoint

The bounded legacy gate in §§31.34.35 and 31.34.39–31.34.42 is now
implemented and independently verified in both runtimes. The implementation
is private: neither the TypeScript package index nor the Python package root
exports the campaign. It adds no permanent table or index, executes no
migration, writes no v2 row and persists no projection or cursor seal.

The one-shot campaign starts only after the ordered handoff, stream/record,
checkpoint and lease/lock/hold campaigns have completed. Five rules execute in
registry order: `BLR_LEGACY_INVENTORY`, `BLR_LEGACY_APPEND_BINDING`,
`BLR_LEGACY_CHECKPOINT_BINDING`, `BLR_LEGACY_LEASE_BINDING` and
`BLR_LEGACY_LOCK_BINDING`. Every rule is fixed marker-only SQL with a bound
`diagnosticLimit + 1`; the executor streams at most 65 marker rows, closes each
owned cursor exactly once and preserves the authoritative creation, fetch,
fence or rule failure over a secondary cleanup failure.

Inventory uses three mutually exclusive `UNION ALL` branches: relation-led
disagreement, common-without-relation and exact-nine main operation without a
relation or matching common key. It binds tenant, operation ID/name, request
hash, result hash and commit clock in both directions while retaining the
staged result-blob digest without selecting or decoding `result_blob` again.
The other four rules implement exactly the recoverability ceiling frozen in
§31.34.42. Cross-tenant aliases, same-tenant ambiguity, older saves, later
delete/recreate, later lease/lock acquisition, current-state drift, split
release identity/high-water domains and inventory field substitution are all
covered by production-SQL attacks.

The TEMP-stage owner captures `main.schema_version` and the exact
`ge_cycle_operations` `type`, `name`, `tbl_name`, root page and stored SQL before
source staging. Generic stages may retain an absent-table sentinel, but legacy
begin and every legacy fence reject it. Begin, statement creation, every marker
fetch, the sole close, rule transition and completion reprove the receipt plus
the EXCLUSIVE owner/epoch, `total_changes()`, projection reference, common
counts, relation coverage and fixed TEMP catalog. Both runtimes reject a
prebuilt exact-DDL shadow whose six scalar fields are preserved while only the
blob changes; two rename statements leave `total_changes()` unchanged, so the
catalog receipt rather than the ordinary DML fence proves the rejection.

The shared capture time is `1785110405000`. The pristine fixture has baseline
ID `v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af`,
20 entries, nine legacy operations, first entry
`f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c`,
final entry `7438000be18c081b0fd1eff96b3f4c9736dca1b6873285de6f2140d1f2e3bf46`
and projection
`459ecad40c2ed54c59c38bb3fecbabfc71694bdf4f59f1eebbdae749fbb9dd62`.
The hostile fixture has 28 entries and 17 legacy operations, the same baseline
and first entry, final entry
`85cc900b39b8631815f5631aa13711a9ef152f88e91793bb771f0be85b1a55e2`,
projection `a23da0ae704c5d1414fd55950ff1f306eeffb8d5408340dbe713e2fa02b72647`
and explicit five-rule vector `(0, 2, 2, 3, 2)`.

Whitespace-normalized TypeScript and Python rule SQL has exact five-of-five
SHA-256 parity:

1. inventory: `e2604ff607c5e3034f4b1b1c7fa87c2cd034244ebe11a17289ff5100f54586ef`;
2. append: `c18ddc48822f41fa3e6dcafcbdfbb26aed83f9ebcb135c959d5bf32fd0c3b055`;
3. checkpoint: `46a86173db67c4a6e573d68c5bfdf4a8b886862f16857a1c538cbe953ab1ca4d`;
4. lease: `619daa1f02963c6a4ef58331db5157ed2f8a95aa0f99cc3add27e2063f541212`;
5. migration lock: `14ac5f2c3bf01c7b3ac6744b209bded53e7e3001ab94084431a1b92f0f782247`.

Final main-thread evidence is TypeScript legacy focused 222/222, generic stage
33/33 and SQLite package 16 files / 377 tests, with typecheck, lint and build
green. Python legacy focused is 86/86, adjacent operation-baseline is 485/485
and the canonical repository command `cd python && uv run pytest -q` is
1,637/1,637, with full Ruff, scoped Ruff format and strict MyPy green. The
SQLite contract is 19/19, the reconciliation registry remains 54 rules with
`implementationClaim:false`, migration preview remains non-executing, and the
documentation gate resolves 286 local links. Relevant and full diff checks are
green. Final independent review is HIGH 0 / MEDIUM 0 / LOW 0.

This checkpoint does not claim legacy 10K/100K performance. Release-lease and
delete-true necessarily use bounded tenant-prefix existential traversal because
their results omit the request target, and every marker fence rechecks catalog
identity. No permanent index was added. The scheduled scale gate must measure
these paths and catalog-fence overhead at 10K/100K before a throughput claim.
This checkpoint also does not execute `0002`, persist v2 baseline state, prove
crash/replay, complete cursor/publication rules, select a release candidate or
establish adoption, 5K/6K stars or popularity.

### 31.34.44 Cursor and provider-clock invariant campaign gate

The next bounded SQLite slice starts only from the explicit legacy-complete
phase. It shall implement the twelve cursor rules in registry order and no
publication rule:

1. `BLR_CURSOR_AUTHORIZATION`;
2. `BLR_CURSOR_SCOPE`;
3. `BLR_CURSOR_BLOB_CANONICAL`;
4. `BLR_CURSOR_POSITION`;
5. `BLR_CURSOR_EXPIRY_CONSUMPTION`;
6. `BLR_CURSOR_CATALOG_BINDING`;
7. `BLR_CURSOR_SEAL_COUNT`;
8. `BLR_CURSOR_SHAPE`;
9. `BLR_CURSOR_EVENT_BINDING`;
10. `BLR_CURSOR_CHECKPOINT_BINDING`;
11. `BLR_CURSOR_REBIND_COUNT`; and
12. `BLR_CURSOR_SEAL_MISMATCH`.

Before coding, freeze a field-to-rule matrix for all sixteen persisted cursor
columns: tenant, token hash, kind, stream, checkpoint scope, request-scope blob,
page size, next position, optional tail sequence/hash, descriptor hash, schema
identity, snapshot blob, creation, expiry and optional consumption clocks. The
matrix must separate raw shape, canonical decoding, request authorization,
event/checkpoint semantics, physical history binding and seal contribution so
one rule does not silently replace another. Token plaintext is unavailable and
must never be reconstructed or logged.

The clock proof is cross-cutting but must not invent a new diagnostic ID.
`BLR_CURSOR_EXPIRY_CONSUMPTION` proves safe-integer clocks, expiry strictly
after creation and consumption absent or no earlier than creation. The phase
must separately prove that the provider clock high-water captured from the
migration-lock singleton is not behind any provider-owned cursor clock and
that the reconciliation capture clock is not behind that high-water. User
checkpoint RFC3339 timestamps and lease/lock future expiries are not provider
observation clocks and must remain excluded from that aggregate.

Authorization and scope rules must prove that event cursors have exactly one
stream and no checkpoint scope, while checkpoint cursors have exactly one
checkpoint scope and no stream. The decoded request-scope object must equal the
closed contract-version/kind/page-size/target tuple. Descriptor and schema
identity hashes bind to the frozen provider assets, never to caller input.
Canonical-blob rules must bound both blobs before decoding, require exact
canonical re-encoding and keep tenant-controlled content out of diagnostics.

Event binding must prove an existing retained tail for the exact tenant,
stream, sequence and hash, enforce the empty/nonempty tail tuple and constrain
`next_position` to the frozen snapshot. Checkpoint binding must prove every
snapshot summary against an exact tenant/scope/checkpoint `put` revision and
the frozen descending sequence/creation/ID order, while allowing later current
checkpoint mutation. Position and rebinding rules must distinguish consumed,
expired, replayed and newly rebound tokens without inferring unavailable token
plaintext.

Seal design must be written before implementation. It shall stream cursors in
canonical tenant/token-hash byte order and domain-separate each row. Every
immutable scalar, both blob lengths and both blob SHA-256 values contribute;
descriptor/schema identities remain independently checked. `SEAL_COUNT`,
`SHAPE`, `REBIND_COUNT` and `SEAL_MISMATCH` must have non-overlapping diagnostic
units and must not collect all cursor rows or decoded snapshots in application
memory. Fixed SQL, named-index/EQP review and a bounded canonical decoder are
mandatory.

The phase inherits the exact projection reference, owner transaction, write,
main-catalog, TEMP-catalog, common-count, relation-coverage and exact-once cursor
cleanup fences proven above. It adds one private cursor/clock-complete state
required by publication. Tests repeat per-twelve creation/fetch/close, options,
limits, malformed markers, post-diagnostic mutation, rule transition, catalog
replacement, transaction terminal, active disposal and cleanup precedence.
Shared fixtures cover event/checkpoint, active/consumed/expired, boundary page
sizes, empty/nonempty snapshots, retained/missing tails, reordered checkpoints,
descriptor/schema drift, blob noncanonicality, clock regression and seal/count
attacks with literal identities and an exact twelve-number vector.

Fast evidence must include 128 and 1,024 cursors with bounded marker streaming.
The scheduled performance gate, not this fast gate, owns 10K/100K RSS,
p50/p95/p99 and tenant-prefix/catalog-fence cost. Completion again requires
TypeScript/Python normalized SQL and fixture parity, focused/adjacent/full
suites, static checks, contract/registry/docs gates and independent HIGH 0 /
MEDIUM 0 / LOW 0 review. It still may not execute `0002`, publish v2 rows,
persist the final seal, implement the three publication rules or claim release,
adoption or stars.

### 31.34.45 Cursor/provider-clock pre-implementation clarification

This append-only clarification supersedes only the ambiguous cursor field
count, seal order and phase-completion wording in §31.34.44. It does not alter
any already implemented baseline, relation or legacy behavior. No cursor
campaign implementation may begin until the matrix and two-phase ownership
defined here are treated as frozen inputs.

#### 31.34.45.1 Exact physical field inventory and seal boundary

The schema-v1 `ge_cycle_cursors` row has eighteen persisted columns, not
sixteen. The sixteen-field count in §31.34.44 accidentally omitted
`principal_hash` and `authorization_hash` while counting the two fields which
are intentionally mutable during v2 rebinding. The corrected partition is:

- sixteen immutable seal fields: `tenant_id`, `token_hash`, `kind`,
  `principal_hash`, `authorization_hash`, `stream_id`, `checkpoint_scope`,
  `request_scope_blob`, `page_size`, `next_position`,
  `snapshot_tail_sequence`, `snapshot_tail_record_hash`, `snapshot_blob`,
  `created_at_ms`, `expires_at_ms` and `consumed_at_ms`; and
- two separately validated mutable rebind fields: `descriptor_hash` and
  `schema_identity_sha256`.

The immutable seal does not place either raw BLOB in a native-language row
object retained beyond the current cursor. For each BLOB it substitutes the
exact byte length and lowercase SHA-256. Consequently the canonical immutable
seal value has eighteen logical contributions: fourteen non-BLOB scalar
values plus `requestScopeByteLength`, `requestScopeBlobSha256`,
`snapshotByteLength` and `snapshotBlobSha256`. The descriptor and schema
identity contribute to `BLR_CURSOR_CATALOG_BINDING`, the pre-rebind receipt and
the post-rebind identity check, but never to the immutable seal root. Changing
only those two fields must leave the immutable root unchanged; changing any of
the sixteen immutable physical fields, either BLOB length or either BLOB byte
sequence must change it.

The closed field-to-rule allocation is:

| Physical field or derived evidence | Primary rule | Required proof | Must not be substituted by |
| --- | --- | --- | --- |
| `tenant_id`, `token_hash` | `BLR_CURSOR_AUTHORIZATION` | bounded canonical identifiers; token is represented only by its lowercase SHA-256 hash | token plaintext reconstruction, logging or lookup outside the sealed owner transaction |
| `principal_hash`, `authorization_hash` | `BLR_CURSOR_AUTHORIZATION` | both exact lowercase 64-hex authorization carriers are present and enter the immutable seal | request-scope equality or descriptor equality |
| `kind`, `stream_id`, `checkpoint_scope` | `BLR_CURSOR_SCOPE` | event has exactly one stream and null checkpoint scope; checkpoint has exactly one scope and null stream | raw table `CHECK` success alone |
| decoded `request_scope_blob` | `BLR_CURSOR_SCOPE` | exact contract-version/kind/page-size/target object matching the scalar tuple | canonical-byte proof alone |
| both raw BLOB bounds, UTF-8/JSON decoding, duplicate-key rejection and exact canonical re-encoding | `BLR_CURSOR_BLOB_CANONICAL` | bounded one-row decode and byte-for-byte canonical round trip | event/checkpoint semantic acceptance |
| `page_size`, `next_position` | `BLR_CURSOR_POSITION` | safe integer ranges and position valid for the frozen event or checkpoint snapshot | expiry/consumption status |
| `created_at_ms`, `expires_at_ms`, `consumed_at_ms` | `BLR_CURSOR_EXPIRY_CONSUMPTION` | safe integers; expiry strictly after creation; consumption absent or at/after creation; provider clock and capture-clock aggregate described below | lease/lock expiry or user checkpoint timestamp aggregation |
| `descriptor_hash`, `schema_identity_sha256` | `BLR_CURSOR_CATALOG_BINDING` | exact source identities before rebind and exact final identities after the future publication-owned rebind | caller input or immutable seal contribution |
| main cursor count and TEMP seal-stage count | `BLR_CURSOR_SEAL_COUNT` | exact equality at the pre-rebind barrier | `SHAPE` or post-rebind update count |
| complete eighteen-column row arity, SQLite storage classes, nullable groups and hash/identifier lexical bounds not already assigned to semantic rules | `BLR_CURSOR_SHAPE` | one physical row maps to exactly one closed seal carrier | authorization, scope, clock, event or checkpoint semantic rules |
| event tail scalar tuple plus decoded event snapshot | `BLR_CURSOR_EVENT_BINDING` | exact tenant/stream/sequence/hash retained record, exact empty/nonempty tuple and frozen snapshot agreement | current stream-head equality after later append |
| decoded checkpoint snapshot entries | `BLR_CURSOR_CHECKPOINT_BINDING` | each summary has an exact tenant/scope/checkpoint `put` revision and strict frozen descending sequence/creation/ID order | current checkpoint equality after later mutation |
| publication-owned update result | `BLR_CURSOR_REBIND_COUNT` | exactly the pre-rebind receipt row count was rebound once | a new scan root, `total_changes()` alone or seal count |
| post-rebind row count and immutable seal | `BLR_CURSOR_SEAL_MISMATCH` | count and root equal the pre-rebind receipt while every mutable identity equals the final target | descriptor/schema inclusion in the immutable root |

One malformed row may independently violate more than one rule, but each rule
emits at most one marker for that cursor identity. `SHAPE`, `SEAL_COUNT`,
`REBIND_COUNT` and `SEAL_MISMATCH` retain distinct units: physical row,
pre-rebind inventory delta, publication update delta and post-rebind immutable
receipt mismatch respectively. A rule must not hide a violation merely because
another rule would also diagnose the row.

#### 31.34.45.2 Canonical order and private TEMP seal stage

The canonical immutable seal order is `token_hash` unsigned UTF-8 bytes first,
then `tenant_id` unsigned UTF-8 bytes. This matches the existing normative
registry value `token-hash-utf8-bytes, tenant-id-utf8-bytes` and supersedes the
reversed tenant/token wording in §31.34.44. TypeScript and Python must compare
the same raw UTF-8 byte order and may not rely on locale, host string collation
or insertion order.

The schema-v1 main-table primary key is `(tenant_id, token_hash)`. Asking
SQLite to read the two potentially large cursor BLOBs directly in canonical
token/tenant order would require an unowned sort and can produce `USE TEMP
B-TREE`; adding a permanent source index is forbidden. The implementation must
therefore use a private STRICT, WITHOUT ROWID TEMP cursor-seal stage whose
primary key is `(token_hash COLLATE BINARY, tenant_id COLLATE BINARY)`.

The source walker reads `main.ge_cycle_cursors` in its existing
`tenant_id,token_hash` primary-key order, exactly one row at a time. It validates
and decodes the current row, computes both BLOB lengths and SHA-256 digests,
inserts only the closed immutable scalar/digest carrier into the TEMP seal
stage, proves the exact one-row write delta, and releases both BLOBs before
advancing. The TEMP stage never stores request-scope bytes, snapshot bytes,
decoded snapshot arrays, token plaintext or tenant-controlled diagnostic text.
After capture, the seal accumulator streams the small carriers from the TEMP
primary key in canonical token/tenant order without a sort or application-level
collection.

The TEMP object name, complete DDL, domain-separated row encoding, genesis or
empty root and terminal seal encoding must be frozen in both runtimes before a
root is claimed. The two fixed domains remain:

```text
graph-engineering/sqlite-cursor-seal-row/v1\0
graph-engineering/sqlite-cursor-seal/v1\0
```

Every source query, insert, ordered seal fetch and rule marker query requires
an EQP assertion. No plan may contain an automatic index, materialized
subquery, unbounded sorter or TEMP B-tree. The main-catalog receipt must cover
every source object read by cursor rules, including the cursor table, retained
records, checkpoint revisions, migration-lock singleton and schema identity
source. Same-name or exact-shape DDL replacement between capture, decode,
digest, insert, seal and rule boundaries poisons the stage even when
`total_changes()` does not move.

#### 31.34.45.3 Provider-clock ownership correction

The completed source foundation already compares the migration-lock
`updated_at_ms` high-water with provider-owned observation clocks. Cursor
creation and consumption clocks are presently included in that broad maximum,
which means a cursor-only regression can fail before a cursor rule is able to
emit `BLR_CURSOR_EXPIRY_CONSUMPTION`. The cursor phase must own its diagnostic
without weakening the final clock invariant.

Source capture must retain immutable evidence for the caller-supplied capture
clock, the migration-lock provider high-water and the maximum non-cursor
provider observation. It continues to fail immediately if the high-water is
behind any non-cursor provider observation or if capture predates the
high-water. Cursor creation and non-null consumption clocks are then checked
separately by the cursor campaign against the same frozen high-water. A cursor
clock ahead of it is one `BLR_CURSOR_EXPIRY_CONSUMPTION` unit, not a generic
source failure. Campaign completion reproves that the capture clock is not
behind the high-water and that the high-water is not behind either the
non-cursor maximum or any cursor creation/consumption clock.

Lease and migration-lock future expiry clocks and checkpoint RFC3339 creation
timestamps remain excluded. Cursor `expires_at_ms` participates in the local
strict-after-creation rule but not in the provider observation maximum. This
split changes diagnostic ownership only; it must produce the same final valid
clock ordering as the earlier combined query.

#### 31.34.45.4 Two-phase rule ownership and completion state

Rules one through ten are pre-rebind rules. Under the exact legacy-complete
stage, they validate and stage all cursors, prove the provider clock, compute
the immutable seal and return a frozen pre-rebind receipt containing at least
the exact cursor count, immutable root, source descriptor identity, source
schema identity, captured provider high-water and the exact projection
reference. This action is read-only for main and permanent state. It may write
only the owned TEMP seal stage with exact accounted deltas.

Rules eleven and twelve are not pre-rebind diagnostics. They belong to a
future publication-owned post-rebind verifier. That verifier accepts only the
exact pre-rebind receipt, the exact publication session and the exact affected
row count returned by the publication owner's single bounded cursor rebind. It
requires `BLR_CURSOR_REBIND_COUNT` equality, streams a second immutable seal,
requires `BLR_CURSOR_SEAL_MISMATCH` count/root equality, and proves every row's
two mutable identities equal the final manifest-bound v2 targets.

The pre-rebind campaign may enter `pre-rebind-complete` and hand out its opaque
receipt. It must not enter `cursor/clock-complete`. Only the future post-rebind
verifier can transition the same private stage session to
`cursor/clock-complete`, and publication rules may later require that exact
state. Abandonment, receipt substitution, projection clone, publication
session mismatch, second verification, partial rebind, extra/missing cursor or
immutable drift poisons the owner and finalizes the active cursor exactly once.

This phase separation resolves the apparent requirement to run all twelve
rules while simultaneously forbidding v2 publication. The current development
slice implements and verifies the pre-rebind half only. It may define the
private verifier contract and test it with deterministic isolated fixtures,
but it must not invoke a real v2 rebind, execute `0002`, claim the final two
rules as integrated, or claim `cursor/clock-complete`.

#### 31.34.45.5 Minimum implementation slice A: seal and clock primitives

The first independently reviewable slice contains no stage lifecycle change
and no permanent database write:

1. add one private TypeScript cursor invariant module and one private Python
   counterpart; neither package index exports them;
2. implement the closed eighteen-column row reader, bounded canonical decoder,
   immutable sixteen-field-to-eighteen-contribution seal carrier and
   constant-space domain-separated accumulator;
3. implement frozen pre-rebind receipt types with defensive copies or immutable
   bytes and one-shot finish behavior;
4. split source clock evidence into capture clock, provider high-water,
   non-cursor maximum and later cursor maximum ownership without changing valid
   source projections; and
5. freeze exact cross-language field names, byte encoding, null encoding,
   genesis/empty behavior and literal roots before integration.

Slice A tests start with empty, one event and one checkpoint carrier; two rows
whose tenant and token orders disagree; all sixteen single-field immutable
mutations; the two allowed mutable-identity mutations; both BLOB length and
same-length content attacks; page sizes 1 and 256; safe-integer clock edges;
invalid UTF-8, BOM, duplicate JSON keys, noncanonical whitespace/key order and
oversized carriers; checkpoint snapshot order; and accumulator underflow,
overflow, duplicate, order regression, second finish and post-finish append.
Every literal root is derived independently in TypeScript and Python before it
is appended as evidence.

Slice A fast characterization covers 128 and 1,024 synthetic carriers through
one-row iteration. Tests prohibit `.all()`, `fetchall()`, `Array.from`, list or
tuple capture proportional to cursor count, decoded-snapshot retention and raw
BLOB retention. They record maximum simultaneously live carrier count and
prove it remains constant. This is characterization, not a 10K/100K or
production-throughput claim.

#### 31.34.45.6 Minimum implementation slice B: pre-rebind campaign integration

After Slice A has exact TypeScript/Python root parity, Slice B may extend the
private stage chain after legacy completion:

1. create and catalog-bind the private TEMP cursor-seal table;
2. add exact begin, fence, cursor registration, cursor release, pre-rebind
   completion, abort and disposal capabilities in both runtimes;
3. implement rules one through ten in registry order with fixed marker-only SQL
   where deterministic SQL is sufficient and bounded one-row decoding where
   canonical or checkpoint semantics require judgment-free code;
4. bind event snapshots to retained record history and checkpoint snapshots to
   exact historical `put` revisions without binding later current state;
5. return the opaque pre-rebind receipt while keeping the final
   cursor/clock-complete state unreachable; and
6. define, but do not integrate with migration, the exact private inputs that a
   future post-rebind verifier will require for rules eleven and twelve.

Slice B tests require a literal pristine fixture and a literal hostile fixture
with exact counts, projection identity, pre-rebind seal and ten-number
pre-rebind diagnostic vector. Attacks cover every rule independently, same
token hash across tenants, tenant/token cross-order, event empty/nonempty
snapshots, missing or later retained tails, checkpoint later mutation,
missing/reordered put history, authorization substitution, descriptor/schema
substitution, cursor insert/delete with equal count, provider-clock regression
and source-object DDL replacement.

Lifecycle tests repeat per-ten statement creation, marker fetch and close;
limits 1, 16 and 64 with genuine fixed SQL at exact and plus-one boundaries;
malformed marker; mutation after a real diagnostic; mutation at rule
transition; table/index/catalog replacement; transaction end; active disposal;
cleanup-only failure; primary failure plus cleanup failure; receipt clone;
second run; abandonment; and attempted start before exact legacy completion.
The cursor walker and seal walker each have one owner, one active cursor and
one exact close on every exit path.

#### 31.34.45.7 Cross-language gates and non-claims

Slice A and Slice B each require normalized TypeScript/Python SQL parity where
SQL exists, byte-for-byte seal carrier parity, identical count/root receipts,
identical safe diagnostics and matching fixture clocks. Focused and adjacent
tests run after every change. Completion evidence also requires the full
TypeScript SQLite suite, typecheck, lint and build; the canonical full Python
suite, Ruff and strict MyPy; SQLite contract and 54-rule registry checks; docs
links; scoped and full diff checks; and a new independent HIGH 0 / MEDIUM 0 /
LOW 0 review.

The main integration agent owns the plan, root configuration, spec and final
cross-language evidence. TypeScript and Python runtime lanes own only their
assigned files. No formatter may rewrite another lane. Shared fixtures must be
literal and independently recomputed rather than copied from one runtime into
the other.

This clarification and both minimum slices do not execute or modify `0002`,
alter a permanent v1 table/index, write a v2 row, rebind a real cursor, persist
the immutable seal, implement publication rules, mark the registry
`implementationClaim:true`, prove 10K/100K memory behavior, prove crash/replay,
select a release candidate, or establish adoption, star count or popularity.
Until a future publication-owned rebind and rules eleven/twelve pass, the only
truthful terminal claim is a verified private pre-rebind cursor receipt; the
project must not claim cursor completion or cursor/clock completion.

### 31.34.46 Post-audit legacy recoverability closure and superseding evidence

An external read-only Claude Code audit of the live implementation found two
release-blocking gaps after the first completion checkpoint in §31.34.43: the
TypeScript suite did not yet prove that the four binding rules accept all six
safe later-history evolutions, and a count-preserving rank-eleven relation-key
substitution could produce both a relation-led and common-led inventory marker
for one tenant/operation identity. Five supporting evidence gaps were also
reported around result-blob-digest drift, the TypeScript begin write fence,
equal-count TEMP mutation, cross-runtime index metadata and the actual
non-key-lookup query shapes. This section supersedes only the affected evidence
and hash/count statements in §31.34.43; all earlier plan bytes remain intact.

The inventory SQL now excludes the common-led branch whenever the normalized
relation still contains the same decoded tenant/operation identity, even when
the two key blobs disagree. The relation-led branch therefore owns that
identity and the three `UNION ALL` branches remain mutually exclusive without a
distinct operation or TEMP B-tree. Both runtimes execute a real key-blob
substitution and freeze the resulting inventory count at one. The new
whitespace-normalized inventory SQL SHA-256 is
`47955bd3ba75cbfd515d95cff82dd28213d956818e06a597e07a7376a7874f46` in
both TypeScript and Python; it supersedes only the former inventory digest.
The append, checkpoint, lease and migration-lock hashes remain unchanged.

TypeScript now proves the same six permitted evolutions already required in
Python: a later append head, checkpoint delete/recreate, later lease
acquisition, same-tenant ambiguous lease history, later current lease
holder/expiry state and a later migration-lock acquisition. Every case returns
an empty diagnostic report, proving that the implementation does not bind more
strongly than §31.34.42. Both runtimes additionally exercise relation and
common `resultBlobSha256`/`result_blob_sha256` drift plus a legal operation-name
substitution. No campaign query selects, retains or decodes the main
`result_blob` column.

The TypeScript legacy constructor now checks `total_changes()` immediately
before catalog/count/coverage proof and again after it. A real equal-count TEMP
no-op update therefore fails at begin before any rule statement is prepared,
matching Python. TypeScript rule descriptors now carry frozen
`requiredIndexes` arrays equal to the Python tuples, and both EQP tests run on
the shared pristine nine-operation fixture. The tests require every named
index and reject `AUTOMATIC`, `MATERIALIZE` and `TEMP B-TREE` plan nodes.

The rules intentionally contain more than one bounded non-direct lookup, so
the singular wording in §31.34.35 is corrected here. Append performs a
tenant/hash tail lookup plus a stream-sequence range count. Save/delete
checkpoint recovery uses a tenant-prefix history search because a delete
result omits its request target. Acquire/renew lease uses an exact used-ID
domain, while release performs a tenant-prefix used-ID traversal joined back to
its own lease stream because the result omits the stream and lease ID. Main
inventory recovery scans only the closed nine operation names and checks for a
matching staged identity. These paths are fixed, bounded by marker limit and
covered by named-index/EQP evidence, but they are not claimed performant at
10K/100K; that remains scheduled performance debt.

Two append defensive guards (`tail_exists IS NOT 1` and
`appended_records < 1`) are unreachable after the stricter staging table
checks, while the negative range-start and missing/short physical range
branches remain directly hostile-tested. Keeping the unreachable predicates is
defense in depth, not evidence that malformed staged rows can bypass the TEMP
contract. Python now owns its local strict 1..64 diagnostic-limit validator
rather than importing another campaign's bound.

Superseding main-thread evidence after these corrections is TypeScript legacy
focused 232/232 and SQLite 16 files / 387 tests, with typecheck, lint and build
green. Python legacy focused is 89/89 and the canonical full suite is
1,640/1,640, with Ruff and strict MyPy green. `git diff --check` is clean. This
closure still adds no public export or permanent index, does not execute
`0002`, does not persist a v2 row or seal, and makes no release, adoption,
performance or star-count claim.

### 31.34.47 Second external audit closure and query-shape correction

A second external Claude Code read-only audit rechecked the live legacy
campaign after §31.34.46. It confirmed both former HIGH findings and all five
former MEDIUM findings closed, then reported three LOW residuals. Those
residuals are closed here without weakening any prior fence or recoverability
ceiling.

Python now attacks the rank-eleven common carrier directly for both
`resultBlobSha256` and a legal operation-name substitution, in addition to its
existing normalized-relation attacks. Each mutation targets one exact decoded
operation identity and produces one inventory unit. TypeScript and Python also
freeze the complete five-entry `requiredIndexes` topology as literal ordered
tuples/arrays, so a one-runtime metadata change fails even if that runtime's
local EQP happens to continue using the edited index.

Python legacy completion now reproves the main operations catalog receipt
after terminal common-count, relation-coverage and TEMP-catalog barriers, then
rechecks the write/transaction fence before marking completion. A prebuilt
exact-shape blob-only shadow swapped at that final boundary is terminal even
when `total_changes()` remains unchanged. Depending on which stronger fence
observes the DDL first, the safe failure is catalog inventory drift or
transaction-epoch drift; completion is unreachable in either case.

The physical query-shape wording is corrected again: acquire/renew lease is
not a direct used-ID key lookup because the retained result does not contain
the request stream and `ge_blr_used_leases_epoch_uidx` begins with
`(tenant_id, stream_id, lease_epoch)`. Acquire, renew and release therefore all
perform bounded tenant-prefix history traversal; release additionally joins
the matching used row back through its own stream to the lease high-water.
Delete-true similarly performs a tenant-prefix checkpoint-history existence
search because the result omits the requested scope/checkpoint. These are
semantic necessities, not 10K/100K performance proof, and remain scheduled
scale debt.

Focused closure evidence is TypeScript legacy 232/232 and Python legacy
92/92, with Ruff/format/strict-MyPy and TypeScript static checks green. The
second audit's residual severity is therefore HIGH 0 / MEDIUM 0 / LOW 0. This
append changes no registry claim, public export, permanent object, migration,
v2 persistence, release or popularity assertion.

### 31.34.48 Cursor immutable-seal A1 cross-runtime implementation checkpoint

This checkpoint freezes and implements the smallest safe sub-slice of Slice A
from §31.34.45: private, database-independent cursor-row decoding and a
constant-space immutable seal. It intentionally stops before the source-clock
capture, projection receipt, TEMP campaign integration, post-rebind checks or
any permanent migration work described by Slice A2 and Slice B. The split is a
delivery boundary, not a relaxation of the later acceptance criteria. No
registry completion bit may change until all remaining cursor and provider-
clock work has its own cross-runtime evidence.

The physical decoder consumes exactly the eighteen v1 `ge_cycle_cursors`
columns in the frozen order: tenant, token hash, kind, principal hash,
authorization hash, stream, checkpoint scope, request-scope BLOB, page size,
next position, snapshot tail sequence/hash, descriptor hash, schema identity,
snapshot BLOB and the three lifecycle clocks. It rejects wrong arity, nullable
violations, noncanonical or duplicate-key JSON, invalid UTF-8, nonportable JSON,
unsafe integers, oversized BLOBs, invalid identifiers and hashes, inconsistent
event/checkpoint scope shapes, invalid tail pairs and invalid clock intervals.
The decoder retains no raw BLOB after deriving a bounded SHA-256/byte-length
identity, and mutable descriptor/schema identities are carried beside rather
than mixed into the immutable carrier.

The closed carrier has exactly eighteen contributions in canonical JSON key
order: authorization hash, checkpoint scope, consumed/created/expires clocks,
kind, next position, page size, principal hash, request-scope digest/length,
snapshot digest/length, snapshot-tail hash/sequence, stream, tenant and token.
Rows are supplied in unsigned UTF-8 token-hash order with tenant bytes as the
tie-breaker. Duplicate or descending keys are terminal. The row digest is
`SHA256(rowDomain || u64be(carrierByteLength) || canonicalCarrierBytes)`, where
`rowDomain` is `graph-engineering/sqlite-cursor-seal-row/v1\0`. The genesis is
`SHA256(sealDomain || 0x00)`; row ordinal `n` advances to
`SHA256(sealDomain || 0x01 || priorState || u64be(n) || rowDigest)`; and the
terminal root is
`SHA256(sealDomain || 0x02 || u64be(cursorCount) || terminalState)`, where
`sealDomain` is `graph-engineering/sqlite-cursor-seal/v1\0`. Every rejected
append computes and validates its candidate before changing count, state or
sort key, and `finish` succeeds exactly once only at the declared count.

Both runtime accumulators now require the expected cursor count plus the
frozen source descriptor and schema-identity hashes. Every decoded physical
row must match both identities. The frozen A1 receipt contains only cursor
count, immutable-root SHA-256 and those two source identities; the algorithm
version remains a module constant. The type is deliberately named
`SQLiteCursorImmutableSealReceipt`, not a pre-rebind receipt, because the
future opaque pre-rebind receipt must additionally bind exact projection,
provider high-water, capture clock/session and campaign ownership. Neither
source identity enters the immutable root, so later controlled rebinding does
not falsify the closed carrier while source substitution still fails before a
receipt can be issued.

Claude Code authored the initial TypeScript implementation and its adversarial
tests in an isolated worktree. The main integration lane independently built
and then reconciled the Python implementation. A cross-runtime audit required
four contract corrections before acceptance: TypeScript source identities were
added to the accumulator and receipt, Python now fully revalidates hand-built
carriers at append, both runtimes reject a second `finish`, and both expose the
same canonical carrier-key order and receipt semantics. Shared literal event,
checkpoint and pair fixtures are now recomputed by both implementations rather
than inferred from runtime-local examples.

The frozen shared roots are: empty
`587bd52db10d2d03c9f7b8bbcecee9c6f83d0c076b17846883e6885e10e2b47f`,
event `1445422fdd2e7e6f93458c6d5e4cf35c53ebac8596cf117595c1f926086681ea`,
checkpoint `4fefb119ba4e71217c64470627ce9b07388ffdd29cf0b3549b7127b06436f5f6`
and ordered pair
`3ee9a67ea7d1d961af54178d1df8c3cdf32dddfd4d7c5dcae03aca31efad84d1`.
Characterization streams 128 and 1,024 carriers through a one-pass iterable,
proves the accumulator keeps only count, one 32-byte state and one prior sort
key, and statically rejects proportional capture helpers. This is bounded
functional evidence only; it is not the still-required 10K/100K RSS,
throughput, crash/replay or production-scale proof.

Acceptance for this A1 checkpoint requires the focused TypeScript and Python
suites, the full SQLite and canonical Python suites, TypeScript typecheck/lint/
build, Ruff/format/strict MyPy, legacy regression suites, contract/registry/docs
checks, clean scoped diffs and a fresh independent severity-zero review. The
module remains private with no package export. This checkpoint executes no
database statement, changes no permanent or TEMP object, does not run `0002`,
does not rebind a cursor, persists no seal or v2 state, does not claim cursor or
provider-clock completion, and makes no release, adoption or star-count claim.

### 31.34.49 Cursor immutable-seal A1 final acceptance evidence

The post-reconciliation independent audit re-read the current main-worktree
TypeScript and Python modules, their adversarial suites and the boundaries in
§31.34.45 and §31.34.48. It reports HIGH 0 / MEDIUM 0 / LOW 0. In particular,
the final Python accumulator now accepts the complete decoded seal row, binds
descriptor and schema identity before any state advance and matches the
TypeScript fail-closed boundary. Both runtimes assert an exact four-field
immutable-seal receipt, revalidate hand-built carriers, keep rejected appends
atomic and reject finish reuse. The audit independently confirmed identical
domains, carrier keys, byte order, framing, recurrence, terminal formula and
the four frozen roots recorded in §31.34.48.

Final main-thread evidence is TypeScript cursor focused 21/21 and SQLite 17
files / 408 tests, with package typecheck, lint and build green. Python cursor
focused is 31/31, legacy regression is 92/92 and the canonical full suite is
1,674/1,674, with full Ruff check, strict MyPy across 48 source files and
scoped format checks green. The SQLite ledger/reconciliation/migration contract
is 19/19; the baseline registry remains exactly 54 rules with
`implementationClaim:false`; documentation validation checks 286 local links;
and full/scoped diff checks are clean. The master-plan and daily-log changes
are append-only relative to the prior commit.

This acceptance closes only immutable-seal A1. Full Slice A still requires the
source-clock split, exact projection/provider-high-water capture and opaque
pre-rebind ownership receipt. Slice B still requires the TEMP cursor campaign,
registered rule execution, lifecycle/fault evidence and controlled pre-rebind
completion. No database integration, `0002`, permanent v2 write, post-rebind
verification, 10K/100K performance, crash/replay, release, adoption or star
claim follows from this checkpoint.

## 31.35 Master-plan completion audit and cursor source-clock A2a checkpoint

### 31.35.1 Completion truth and execution boundary

The 2026-07-28 full-plan audit re-read this plan from beginning to end and
cross-checked it against the task registry, evidence registry, source tree,
tests, release artifacts and public repository state. The plan is not complete.
At the audit snapshot the task registry contains 107 records: 41 completed,
seven in progress and 59 planned. The evidence scan contains 77 required
entries, of which 13 are satisfied and 64 remain open. The release checklist
still contains 178 open leaf requirements. These counts are planning evidence,
not a substitute for source-and-test verification, and must be recomputed at
every future completion audit.

The detailed domain matrix is recorded in
`codex_logs/reviews/MASTER-PLAN-COMPLETION-AUDIT-2026-07-28.md`. Its critical
path confirms that authoring, compiler, scheduler, pipeline integration,
router/barrier runtime execution, durable production backends, native cycles,
pattern catalog, CLI/MCP breadth, provider adapters, budget enforcement,
observability, Explorer, course material, release engineering and growth work
all retain open obligations. The repository must not be described as complete,
production-ready, stable, 5K/6K-star, or more popular than Loop Engineering
until the matching objective evidence exists.

### 31.35.2 Accepted A2a source-clock ownership

Cursor Slice A2 is now split into a narrow accepted A2a checkpoint and the
still-open A2b receipt checkpoint. A2a replaces the ambiguous combined maximum
clock with a frozen three-clock source envelope in both runtimes:

1. capture clock (`capturedAtMs` / `captured_at_ms`);
2. maximum non-cursor observed clock
   (`maximumNonCursorObservedAtMs` /
   `maximum_non_cursor_observed_at_ms`);
3. provider high-water clock (`providerHighWaterAtMs` /
   `provider_high_water_at_ms`).

The SQL maximum deliberately excludes cursor `created_at_ms`, cursor
`consumed_at_ms`, cursor expiry, lease expiry, migration-lock expiry and
checkpoint RFC3339 current/revision timestamps. It retains the fifteen
non-cursor clock-bearing branches needed to establish the source boundary.
Both runtimes enforce provider high-water greater than or equal to the
non-cursor maximum and capture clock greater than or equal to provider
high-water. The normalized shared SQL is frozen at SHA-256
`c85e9836aadf613752aa9ba078c00248a4aa5cc3faafda916409b1ddf3201e1b`.

Claude Code 2.1.220 with Opus authored the initial TypeScript A2a change and
adversarial suite in an isolated worktree. The integration lane reviewed and
ported the change through `apply_patch`, independently implemented the Python
counterpart and expanded cross-runtime evidence. This use of Claude Code does
not transfer release authority: every generated change remains subject to the
same local tests, independent review and scoped-diff controls as human-authored
code.

The accepted tests prove the same shared clock fixture in both runtimes, all
retained branches, all excluded cursor/expiry/timestamp branches, persisted
safe-integer boundaries, negative and fractional rejection, source-envelope
capture equality and exact SQL parity. The handoff clone follows the new exact
shape. Final focused evidence is TypeScript 13/13 and Python source/handoff/
cursor 106/106. Full evidence is TypeScript SQLite 17 files / 412 tests and
Python 1,679/1,679, with TypeScript typecheck/lint/build and Python Ruff,
format/strict MyPy green. The final independent TypeScript, Python and
cross-runtime reviews each report HIGH 0 / MEDIUM 0 / LOW 0.

### 31.35.3 A2b pre-rebind ownership receipt — next blocking implementation

A2a does not issue a pre-rebind receipt and therefore does not complete A2.
A2b must be implemented in this exact order, with TypeScript and Python kept in
lockstep and no public package export until all gates pass:

1. Freeze an exact projection reference that commits to the immutable cursor
   projection, physical column order, normalized query identity and the A1 seal
   algorithm/version.
2. Define a capture-session identity with explicit tenant, source-stage,
   campaign and connection ownership. It must be opaque to downstream callers,
   immutable after construction and unsuitable for reconstruction from public
   scalar fields.
3. Bind source descriptor hash, schema identity hash, exact projection
   reference, A1 cursor count/root, capture clock, maximum non-cursor observed
   clock and provider high-water into one substitution-resistant receipt.
4. Enforce one successful issuance. A failed candidate must not consume the
   issuer; a successful issuance must make every later call fail closed.
5. Reject mixed source stages, sessions, campaigns, descriptors, schemas,
   projections, high-waters, cursor roots or counts before producing any
   receipt-shaped value.
6. Use domain-separated canonical framing with explicit byte lengths and
   frozen key order. Do not depend on object insertion order, locale comparison,
   platform integer width or implementation-specific JSON formatting.
7. Add shared literal fixtures and frozen cross-runtime receipt roots for empty,
   one-row, multi-row and hostile-boundary cases. Each runtime must recompute,
   not import, the other runtime's expected value.
8. Add mutation tests for every contribution and pairwise substitution tests
   for session, stage, campaign, projection and provider high-water identities.
9. Prove failed issue attempts are atomic, post-success reuse is rejected and
   mutable input buffers cannot alter the receipt after issuance.
10. Preserve the private-module boundary. No database command, migration,
    cursor update, permanent state write or registry implementation claim is
    permitted in A2b.

A2b acceptance requires focused suites, full TypeScript/Python suites,
typecheck/lint/build, Ruff/format/strict MyPy, normalized SQL and framing parity,
shared-root recomputation, diff checks and a fresh independent severity-zero
review. Only then may the A2 receipt become the sole input to Slice B.

### 31.35.4 Slice B cursor campaign — implementation queue after A2b

Slice B remains a database-integrated campaign and must not be simulated with
in-memory helpers. The implementation queue is:

1. open the exact owned SQLite connection and verify the A2b session/source
   receipt before creating any TEMP object;
2. establish a bounded TEMP cursor campaign keyed by the opaque receipt,
   source descriptor, schema identity and provider high-water;
3. stream the exact cursor projection without retaining request/snapshot BLOBs,
   with deterministic token-hash then tenant-byte ordering;
4. execute every registered cursor rule against the campaign with bounded
   `diagnosticLimit + 1` reads, exact truncation behavior and cursor close
   precedence;
5. keep cursor creation and consumption clocks out of the provider source
   maximum while separately proving their lifecycle order and capture-window
   ownership;
6. re-prove A1 count/root and A2b ownership immediately before controlled
   rebinding; reject every mismatch before the first permanent write;
7. perform rebinding only inside the specified transaction/lock boundary and
   require exact affected-row counts for every mutation;
8. inject faults before TEMP creation, during scan, after scan, before first
   update, between updates and before commit; prove rollback and retry semantics
   for each point;
9. prove cancellation, busy/locked, statement failure, malformed-row and
   connection-loss cleanup without leaked cursor, statement, TEMP object or
   transaction state;
10. add 10K and 100K cursor campaigns with RSS, throughput and query-plan
    evidence, then crash/replay verification and a clean-repository rerun;
11. keep migration `0002`, v2 persistence and post-rebind verification as
    separately reviewed checkpoints rather than silently folding them into the
    first integration change;
12. change the rule registry's implementation claim only after every mandatory
    rule and lifecycle gate is evidenced in both runtimes.

### 31.35.5 Parallel product lane after the cursor blocker

The next product-critical item whose declared dependencies are already closed
is `D6-ROUTER-BARRIER-023`. It should proceed in parallel with A2b when safe
worktree isolation is available. The lane must convert existing pure router and
barrier evaluators into compiler/runtime-integrated graph semantics, including
typed branch outputs, skipped-node terminal state, deterministic join policy,
timeout and partial-input behavior, replay/checkpoint compatibility, trace
events, CLI visibility and cross-runtime conformance. It is not complete merely
because a standalone evaluator test passes.

After D6, the scheduler/pipeline lane must remove unnecessary global barriers,
add bounded streaming backpressure and demonstrate that independent items can
occupy different pipeline stages concurrently. The durable lane must then add
a real production backend and recovery evidence. These lanes must continually
update the audit matrix, but may mark a requirement closed only with a source,
test, documentation or release artifact that directly proves it.

### 31.35.6 Commit and reporting discipline

Every milestone commit must stage only the intended paths, pass `git diff
--check`, record exact gate counts and use `reacher-z <mtrxcop@gmail.com>` as
both author and committer with no co-author trailer. Push success must be
verified by comparing local HEAD, upstream and remote branch OIDs. Development
logs must name Claude Code and sub-agent contributions, review findings,
corrections, failed experiments and explicit nonclaims. Star targets remain a
growth objective, never an engineering acceptance result; no exact star count
is promised because adoption is external and cannot be guaranteed by code.

### 31.35.7 Cursor A2b opaque ownership receipt acceptance

Cursor A2b is complete as a pure private primitive in TypeScript and Python.
It freezes the tenant-then-token physical source query, the sixteen immutable
and eighteen total physical fields, the A1 seal algorithm, the actual six-field
baseline projection identity, four module-minted ownership capabilities, one
capture session and the exact A1/A2a evidence into a thirteen-contribution
pre-rebind receipt. Projection references and receipts are opaque identity
objects backed by module-private provenance stores; scalar copies cannot be
used as capabilities.

The exact query SHA-256 is
`dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4` and
the static projection-contract root is
`82bbb4c486590745fb6363151418bb8f50a1c56c4438c8b535b60f01fca7f8b9`.
Both runtimes use identical NUL-terminated contribution, capture-session,
static-projection, baseline-projection-reference and pre-rebind-receipt domains.
All canonical documents are framed as domain plus unsigned 64-bit byte length
plus canonical UTF-8 bytes.

Four real cross-runtime vectors now pass through actual fresh-v1 source capture,
the actual baseline accumulator, the actual A1 physical decoder/sealer and the
A2b issuer in each runtime. Their receipt roots are empty
`e63c0eed6c3cb3aee2f8d12e1562395ff577af4c4721b59397111cae6bc032ad`,
one event `cb710d7ec15c2e5c729ee813d5f0b03dcfdf795203df8a4ecf5a174b063743f6`,
event plus checkpoint
`f0571ef81f6864bccc2bedbe81f586363bb3d8ca2ff38b3545f95bfbe808b6c7`
and MAX_SAFE/1,024 hostile fleet
`e319abeed2696190770ff3a54669afeb24eff4810dae6072cb3a8141766037fa`.
Each runtime recomputes rather than imports the other runtime's result.

The one-shot issuer snapshots the exact source summary, clock evidence, A1
receipt, baseline projection, projection reference, session and four ownership
handles. Failed validation is atomic and leaves the issuer usable; successful
issuance consumes it only after the opaque receipt and its provenance are
recorded. The repeatable package-private fence accepts only the original receipt
and returns the frozen exact-context witness without consuming or transitioning
it. Tests cover equal-value clones, mutable input buffers, same-byte/new-object
capabilities, unsafe and MAX_SAFE integers, every receipt contribution,
insertion-order independence, source/count/schema drift, pairwise A/B mixed
provenance, hidden fields, accessors/proxies and private-boundary attacks.

The accepted final evidence is TypeScript A2b 14/14, adjacent 280/280 and
SQLite 18 files / 426 tests with typecheck, lint and build green. Python A2b is
25/25, adjacent 131/131 and full 1,704/1,704 with Ruff, scoped formatting and
strict MyPy over 49 source files green. The final independent cross-runtime
audit reports HIGH 0 / MEDIUM 0 / LOW 0. Detailed evidence is in
`codex_logs/reviews/SQLITE-CURSOR-A2B-OWNERSHIP-AUDIT-2026-07-28.md`.

This closes only A2b. It does not execute the main cursor query, create the TEMP
seal stage, run cursor rules one through ten, reach `pre-rebind-complete`, run
`0002`, publish/rebind cursors, run post-rebind rules eleven/twelve, reach
`cursor/clock-complete`, change the registry, prove scale/crash recovery or make
any release, adoption or star claim. Slice B in §31.35.4 is the next cursor
blocker; D6 router/barrier integration remains the parallel product lane.

### 31.35.8 D6 conditional-routing runtime tranche acceptance

The first scheduler-integrated part of `D6-ROUTER-BARRIER-023` is complete in
TypeScript and Python. This is a source milestone for conditional routing, not
completion of D6. Both native schedulers now execute the exact package-owned
condition document emitted by `routedBranches`:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
  "kind": "RouteEquals",
  "routeKey": "security"
}
```

A router without an override executor applies the pre-existing deterministic
route-selection primitive to its bound input using `node.config` as the policy.
A custom executor may participate only by returning the exact eight-field
`RouteSelectionResult`. The runtime does not trust the result's self-reported
request: it recomputes the decision from the authoritative bound node input and
the immutable compiled policy, then requires exact canonical equality before a
success can be journaled. Malformed input, invalid policy, forged request,
forged selected routes and contradictory reason/default/escalation fields fail
as non-retryable `INVALID_ROUTE_SELECTION` after one attempt.

Every structural dependency still waits for its source to reach a terminal
state, but only active edges participate in input binding. A non-selected branch
settles as `skipped` with `ROUTE_NOT_SELECTED` and zero attempts. An
inactive-only descendant inherits that control-flow terminal. A node with both
active and inactive incoming paths executes with only the active bindings, so
the `routedBranches` merge receives the selected branch rather than waiting for
or fabricating values from pruned work. `ROUTE_NOT_SELECTED` remains recorded on
the node for inspection but is excluded from graph-level failures; a named graph
output that points to inactive work remains incomplete and therefore makes the
run fail without inventing a second failure.

The runtime performs a fail-closed pre-dispatch check for unsupported,
malformed or non-router `edge.condition` documents. The exact source node
settles with `UNSUPPORTED_EDGE_CONDITION`, zero attempts and the sorted aggregate
of offending edge messages. No source executor runs. This runtime guard does
not replace the still-open compiler diagnostic and exhaustiveness contract.

Durable start, fold and resume preserve the same semantics. Successful router
history is revalidated against the committed scheduled input and current
compiled policy before a terminal result is returned or a run resumes. Exact
zero-attempt unsupported-condition settlements survive a process loss, while
attempt-bearing or successful history for such a source is invalid. Inactive
branches cannot be forged into `NodeScheduled`, `NodeStarted` or
`NodeSucceeded` events. Structural-but-inactive inputs never fall back to graph
input. Real event-first scheduled order is retained across interleaved branches;
folding no longer topologically re-sorts the history. Replayed runs reuse the
recorded validated node result and do not invoke the router executor again.

The adversarial review found and closed the following defects before
acceptance:

1. an inactive named output produced inconsistent scheduler and durable terminal
   failure projections;
2. Python durable fold reordered real interleaved scheduling events and rejected
   valid terminal history;
3. exact unsupported-condition zero-attempt history could not resume after a
   crash;
4. terminal forged history could execute a source that should have failed its
   condition contract before dispatch;
5. router output was internally self-consistent but not bound to authoritative
   node input, allowing request substitution;
6. TypeScript classified invalid built-in router input/policy as retryable
   execution failure;
7. TypeScript durable input reconstruction confused a true graph root with a
   node whose structural inputs were all inactive; and
8. Python lacked the symmetric resigned-history regression for an attempted
   inactive branch.

Final evidence is TypeScript runtime 11 files / 243 tests, with the focused
scheduler/durable set 85/85 and runtime typecheck, lint and build green. Adjacent
TypeScript patterns are 93/93 and primitives 147/147. Python focused
scheduler/durable is 94/94 and the final post-parity full Python rerun is
1,749/1,749 plus two nested subtests, with Ruff, scoped
formatting and strict MyPy green. Documentation links and scoped diff checks are
green. The final independent cross-runtime review reports HIGH 0 / MEDIUM 0 /
LOW 0. Evidence is recorded in:

- `codex_logs/reviews/D6-TS-ROUTER-RUNTIME-TRANCHE-2026-07-28.md`;
- `codex_logs/reviews/D6-PY-ROUTER-RUNTIME-AUDIT-2026-07-28.md`; and
- `codex_logs/reviews/D6-CONDITIONAL-ROUTING-CROSS-RUNTIME-AUDIT-2026-07-28.md`.

Claude Code 2.1.220 with Opus was also run in an isolated D6 contract worktree.
Its draft changed the already published `RouteEquals` annotation and router
configuration shapes, contained duplicate fields and did not match the current
patterns/runtime boundary. The primary review stopped it and integrated none of
its output. The accepted code and tests came from the two native runtime lanes
under independent cross-runtime review.

`D6-ROUTER-BARRIER-023` remains open. The next D6 tranches must, in order:

1. freeze a shared integrated-router/barrier semantics document and literal
   cross-runtime conformance corpus without changing the published
   `RouteEquals` carrier;
2. add compiler diagnostics for exact router config, route membership,
   duplicate route targets, exhaustive single/multicast coverage and explicit
   default/no-match behavior before any executor can run;
3. add a dedicated durable `RouteSelected` decision identity/event and prove
   zero evaluator/provider calls on replay, corrupted partitions fail closed and
   selected/pruned edge IDs are an exact disjoint partition;
4. integrate all/minimum/percentage barriers with complete success, failure,
   missing and timed-out statistics;
5. add quorum voting, abstain/unknown evidence, deterministic deadlines, late
   arrivals, cancellation and insufficient-quorum escalation without implicit
   pass;
6. compare TypeScript/Python decision bytes, terminal results, event order,
   provider-call counts and deadlines using the shared corpus; and
7. add trace and CLI visibility before changing the registry task to complete.

The parallel Cursor Slice B design audit is recorded in
`codex_logs/reviews/SQLITE-CURSOR-SLICE-B-DESIGN-AUDIT-2026-07-28.md`. It keeps
the accepted plan order: verify the input A2b receipt before TEMP creation, bind
the receipt to the exact live captured-source connection, execute the real
database campaign, then recompute the A1 seal from the TEMP-ordered projection
and compare it with the original receipt before any rebind. The next Cursor
implementation slice is the captured-source connection provenance fence and
pre-TEMP campaign constructor; no database/TEMP/rebind claim is made here.

### 31.35.9 Cursor Slice B0a captured-source connection provenance acceptance

The first database-ownership half of Cursor Slice B B0 is complete in
TypeScript and Python. This accepted tranche is named **B0a** to prevent the
source/connection proof from being confused with the still-open stage/campaign
ownership transfer. B0a adds no cursor query and creates no cursor-specific
TEMP object. Its sole purpose is to turn the database-independent A2b receipt
into a repeatably checked proof that the retained source summary was captured
from the exact live SQLite connection and the exact still-active EXCLUSIVE
transaction generation.

The package-private B0a entrypoints accept exactly `(connection, receipt)`.
They always execute the existing non-consuming A2b receipt-provenance fence
first. The source summary and clock evidence are derived only from that retained
A2b object graph; callers cannot supply parallel copies of the summary, clock,
projection, session or capability values. Only after A2b succeeds does B0a
consult module-owned captured-source provenance and live connection state.

TypeScript registers the exact frozen summary returned by
`captureSQLiteV1BaselineSourceSummary` as a `WeakMap` key. The registry value
contains only the exact `SQLiteConnection` and immutable capture epoch. A
structurally equal frozen object, a synthetic summary carrying the same clock
and envelope objects, and a genuine summary presented to another connection
all fail. The returned connection witness is a frozen null-prototype object
with no own keys and is itself backed by a private weak identity registry. Its
repeatable assertion requires the exact A2b receipt and reruns both A2b and the
live source/connection proof.

The first TypeScript implementation used the public overridable connection
getters. Independent attack review reproduced a HIGH-severity race with an
exact captured `SQLiteConnection` subclass: its `transactionEpoch` getter
returned the old epoch while executing a real epoch-tracked PRAGMA, so the
first fence accepted a witness although the base connection had advanced from
epoch 12 to 13. The accepted correction moves owner observation into
`sqlite-connection.ts`. A module-private symbol method reads the class-private
database transaction state, transaction mode and epoch before and after one
synchronous snapshot. The cross-module wrapper invokes a captured copy of the
base-class intrinsic with `Reflect.apply`, so subclass accessors and later
prototype replacement cannot intercept it. The source fence takes two of these
private snapshots, and the A2b/connection fence repeats the complete proof
immediately before publishing the witness.

The hostile TypeScript regression proves both sides of the boundary. While the
connection is stable, arming the subclass getter and invoking B0a does not call
that getter or mutate the connection. If the hostile getter is invoked directly
and advances the real private epoch, both a fresh B0a attempt and a previously
accepted retained witness fail. Rollback followed by a new `BEGIN EXCLUSIVE`
also fails and cannot refresh the historical receipt.

Python adds `weakref_slot=True` to the frozen source summary and records each
successful capture in an `id -> weakref` registry. Acceptance requires both the
integer identity and `reference() is summary`; cleanup removes only its own
still-current reference, so object-ID reuse and stale callbacks cannot grant or
delete provenance. Direct dataclass construction and `dataclasses.replace`
summary clones fail even when they retain the exact live connection, clock and
epoch.

The first Python connection witness was token-guarded but cloneable:
`dataclasses.replace(witness)` copied the real token and all retained fields,
and the clone could revalidate. The accepted correction makes the witness
weak-referenceable with identity equality and registers the exact object in a
module-private `WeakKeyDictionary`. Every revalidation performs A2b first,
requires the exact registered witness type and identity, compares every
registered retained reference and epoch, then reruns source/clock/connection/
EXCLUSIVE/epoch checks. `dataclasses.replace`, `copy.copy`, direct construction
with the real copied token, and subclass attempts all fail while the original
witness remains valid. Deep copy and pickle cannot recreate the retained
SQLite connection. Weak-lifecycle tests prove that neither source nor witness
registries retain dead objects.

Python also normalizes closed-connection observations into the B0a-owned
deterministic `ValueError` vocabulary instead of leaking
`sqlite3.ProgrammingError`. Receipt ordering remains authoritative: a forged
receipt against that same closed connection fails A2b before any connection
property is touched, while a valid receipt reaches the normalized closed-owner
failure. Retained-witness revalidation has the same behavior.

B0a deliberately does **not** compare the source capture's historical
`total_changes` value with the live count. The already accepted baseline TEMP
handoff advances that count through owner-authorized DML. The exact live
allowance belongs to the adjacent `SQLiteBaselineTempStage` fence. Both
languages retain integration evidence after the real baseline TEMP catalog,
cooperative source/relation handoff, ordered projection and clean stream/
record, checkpoint, lease/lock/hold and legacy campaigns. Capture epoch remains
unchanged through that predecessor chain, total changes advance, and B0a
remains valid. An unexplained later TEMP DML still passes the source-only proof
but is rejected by the stage's allowed-change fence, proving that the two
responsibilities are separate rather than silently weakened.

The accepted post-correction verification is:

- TypeScript B0a focused suite: 7/7;
- TypeScript SQLite suite: 19 files and 433/433 tests;
- TypeScript SQLite typecheck, lint/type gate and build: green;
- Python B0a focused suite: 13/13;
- Python adjacent source/stage/cooperation/handoff/cursor suite: 224/224;
- Python full suite: 1,762/1,762 plus two nested subtests;
- Python Ruff, scoped formatting and strict MyPy over 50 source files: green;
- documentation links, strict diff checks and package-root non-export checks:
  green; and
- final independent language-swapped reviews: HIGH 0 / MEDIUM 0 / LOW 0.

Claude Code 2.1.220 with Opus was used as an additional read-only review lane.
It independently identified the missing TypeScript post-handoff lifecycle
test, the historical-epoch/first-cursor-DDL ownership transition, dead
TypeScript provenance state and the raw Python closed-connection error. Its
review did not modify the repository. The stronger sub-agent attack audit
additionally reproduced the TypeScript live PRAGMA getter bypass and Python
witness clone; both were fixed and regression-tested before acceptance.

Evidence is recorded in:

- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-TS-SOURCE-PROVENANCE-2026-07-28.md`;
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-PY-SOURCE-FENCE-2026-07-28.md`;
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-CROSS-RUNTIME-SEVERITY-AUDIT-2026-07-28.md`;
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-TS-FINAL-CORRECTION-AUDIT-2026-07-28.md`;
  and
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-PY-SOURCE-FENCE-FINAL-AUDIT-2026-07-28.md`.

B0a does not complete B0 or Slice B. Before the first cursor-specific
`CREATE TEMP`, B0b must atomically mint a one-way source-to-stage/campaign
ownership transfer that binds the exact receipt, source, connection, clock,
projection, completed legacy state, current stage epoch and current allowed
change count. The historical capture epoch must never be rewritten. After the
transfer, only the stage/campaign owner may adopt exact expected cursor-DDL
epoch transitions, with both source identity and A2b provenance still frozen.
Second begin, stage clone, projection clone, incomplete predecessor campaign,
stale allowed count, wrong connection, rollback/rebegin and any pre-transfer
drift must reject before cursor TEMP DDL.

After B0b, the Slice B queue remains B1 TEMP catalog and pristine capture/seal,
B2 bounded rules 1-10 and A1 root reproduction, then the separately reviewed
publication/rebind and post-rebind work. No cursor scan, rule diagnostic,
rebind, migration `0002`, v2 persistence, scale, crash/replay, release,
adoption or star-count claim is made by B0a.

The implementation-level B0b handoff is frozen in
`codex_logs/reviews/SQLITE-CURSOR-SLICE-B-B0-STAGE-OWNER-BRIDGE-DESIGN-2026-07-28.md`.
Its 624-line brief defines the closed TypeScript/Python coordinator surfaces,
one-way epoch transfer, exact first-DDL `+1` seam, 34 primary hostile scenarios
with mirrored parity cases, verification gates and parallel implementation
lanes. It is design evidence only and changes none of the B0a nonclaims.

### 31.35.10 D6 integrated-router compiler contract revision 2 acceptance

The shared compiler/runtime contract for the next D6 implementation tranche is
frozen in `spec/integrated-router-semantics.md` and
`spec/conformance/integrated-router.case.json`. This is a contract milestone,
not production evidence for the seven new compiler diagnostics. The accepted
revision preserves the exact published three-field `RouteEquals` condition and
direct `node.config` route policy while closing every incompatibility found in
the first contract draft.

The first draft was rejected with HIGH 3 / MEDIUM 4 / LOW 1. It would have
invalidated the existing `routedBranches` constructor because that pattern
preserved an empty classifier config; it treated `RouteEquals` as the only
condition family and would have rejected the three published loop conditions;
and it retained a `lowerLevelRuntimeOnly` unsupported-condition case even
though neither scheduler exposes a safe compiler bypass. It also under-specified
Graph-envelope diagnostic ownership, policy/condition matrices, cross-pass and
within-category order, several runtime terminals and absent-field projection.

Revision 2 makes patterns and compiler enforcement one atomic tranche.
`RoutedBranchesOptions` gains an optional exact `routePolicy`. A supplied policy
is lowered directly only when its ordered `allowedRoutes` equals normalized
branch keys and the classifier config is exactly empty. A legacy empty config
without an option synthesizes a direct single-route policy from those ordered
keys. A matching preconfigured direct policy is preserved. A supplied option
plus non-empty config, invalid policy or branch mismatch fails before returning
a graph. The compiler never infers a policy from edges or metadata.

Conditional ownership is now an explicit registry keyed by exact API version
and kind. D6 owns and validates `RouteEquals`; `LoopContinue`,
`LoopDryVerdict` and `LoopVerdictAtBound` remain registered to the loop pattern
and opaque to this pass. An unregistered version/kind or malformed claimed
`RouteEquals` is `GE1402`. Registered foreign conditions do not count as route
cases or repair route coverage. The corpus retains one currently compiler-valid
graph containing all three loop kinds.

Diagnostic ownership follows the existing envelope. Portable router config
null, scalar or array values are admitted by Graph IR and become
`GE1401_INVALID_ROUTER_POLICY` at the config root. Capture-hostile accessors,
proxies, sparse arrays, cycles and non-portable values remain
`GE1007_INVALID_GRAPH`. Edge condition null or scalar is already rejected by
the Graph envelope as GE1007. The router pass does not relabel earlier failures.

The seven frozen diagnostics are:

- `GE1401_INVALID_ROUTER_POLICY`;
- `GE1402_UNSUPPORTED_EDGE_CONDITION`;
- `GE1403_CONDITION_SOURCE_NOT_ROUTER`;
- `GE1404_ROUTE_NOT_ALLOWED`;
- `GE1405_DUPLICATE_ROUTE_CASE`;
- `GE1406_DUPLICATE_ROUTE_TARGET`; and
- `GE1407_INCOMPLETE_ROUTE_COVERAGE`.

The pass order is canonical capture/envelope; identity/reference gates;
cycle/topology; entrypoint/reachability; graph policies; integrated router;
then strict typed ports. Within the router pass, categories are ordered GE1401
through GE1407 and each category preserves declaration order. Projection
objects visit `code`, `path`, `nodeIds`, `edgeId` and omit absent fields rather
than serializing null. Suppression is local to the invalid router/condition and
does not hide independent routers or later compiler passes.

An independent revision-2 audit found one remaining MEDIUM after the main
remediation: prose specified within-category order, but no literal graph had
multiple routers or two diagnostics in the same GE140x category. The final
corpus adds two deliberately non-lexical multi-router graphs. One declares
`route-z` before `route-a` and freezes two GE1401 projections in node order.
The other declares edge `z-first` before `a-second` across distinct routers and
freezes two GE1402 projections in edge order. Their literal hashes are
`5256e96b8c9cc3f2312e18ce4ad6a584c3de4570bc84f367a97856a057f90df5`
and
`37bbc9da23963b9c91a52e97dad37b7ed63a669433348332742a2349c8d80fd0`.

The final shared corpus contains:

- 6 pattern-lowering cases;
- 29 exact policy cases, matched against both authoritative primitive
  validators including mathematical JSON `1.0` and boolean rejection;
- 14 condition-registry cases;
- 2 literal JSON-envelope cases and 4 host-constructed capture cases;
- 18 full compiler graphs with exact diagnostic projections and literal hashes;
- 7 runtime graphs with literal hashes; and
- 11 reachable runtime cases covering selection, no-match, default,
  confidence escalation, forged output, multicast ordering and limit,
  inactive descendants, mixed-join active failure, inactive named output and
  unknown-request default behavior.

The unsupported-condition scheduler guard remains historical defense in depth,
but it is no longer represented as an impossible post-compiler execution
surface. TypeScript's zero-call public gate is `runGraph(document, ...)`.
Python first proves `try_compile_graph(document)` returns no `CompiledGraph`,
so no handler can be passed to `run_graph`. No validation bypass is introduced.

Accepted evidence is strict duplicate-key JSON and corpus invariants; exact
TypeScript/Python canonical bytes and literal graph hashes 25/25; current public
runtime projections 11/11 in each language; policy paths 29/29 in each
language; condition registry 14/14; TypeScript core/runtime/primitives builds;
patterns 93/93; Python primitive plus scheduler 188/188; 286 documentation
links; and scoped diff checks. The final independent hostile review is HIGH 0 /
MEDIUM 0 / LOW 0.

The review history is retained rather than rewritten in:

- `codex_logs/reviews/D6-INTEGRATED-ROUTER-COMPILER-CONTRACT-2026-07-28.md`;
- `codex_logs/reviews/D6-INTEGRATED-ROUTER-IMPLEMENTABILITY-PARITY-AUDIT-2026-07-28.md`;
  and
- `codex_logs/reviews/D6-INTEGRATED-ROUTER-REV2-FINAL-AUDIT-2026-07-28.md`.

The next D6 source tranche must atomically implement the TypeScript/Python
compiler passes and both pattern lowerings against this corpus, prove every
compiler-invalid public run has zero executor calls, and retain all existing
core/pattern/primitives/runtime/durable suites. Contract acceptance does not
implement `RouteSelected`, durable decision identity, zero-rejudge replay,
integrated all/minimum/percentage barriers, quorum, abstention, deadlines,
late arrivals, cancellation, trace or CLI visibility. `D6-ROUTER-BARRIER-023`
therefore remains open.

### 31.35.11 Cursor Slice B B0b/B1 stage-owner transfer and exact TEMP seal acceptance

Cursor Slice B now has its first complete, independently accepted database-
owning bridge. B0b consumes the already accepted B0a captured-source witness
exactly once and transfers authority to the exact live baseline TEMP stage;
B1 uses that authority for one, and only one, fixed cursor-seal TEMP DDL. This
is an implementation milestone in both TypeScript and Python, not a design-
only freeze.

The implementation preserves the division of responsibility established by
B0a. The immutable capture epoch continues to describe the historical source
observation. It is never rewritten after capture and is never reused as the
post-DDL live owner epoch. B0b instead creates a private stage/session owner
whose live epoch can adopt the single verified B1 transition. The source
receipt remains the sole explicit source, projection and ownership authority;
the new transfer handle adds no reconstructable scalar authority.

The accepted B0b begin path is deliberately closed and ordered:

1. validate the real A2b receipt before reading the connection or stage;
2. recover only registry-owned captured-source provenance;
3. bind the exact receipt, source summary, projection identity and connection;
4. require the exact registered baseline TEMP stage on that connection;
5. require ordered handoff plus stream/record, checkpoint, lease/lock/hold and
   legacy campaigns to have completed with no live cursor, session or cleanup;
6. prove the baseline-only TEMP catalog and main operation identity;
7. prove the current stage epoch and allowed `total_changes` counter through
   private/captured owner observations;
8. prove `ge_blr_cursor_seal` is absent;
9. burn the stage's one-shot transfer latch; and
10. publish only a frozen, null-prototype, empty-own-key, exact-identity handle
    backed by a private weak registry.

B0b itself performs no cursor SQL, creates no cursor object, changes no main or
TEMP row, does not advance the owner epoch and does not change the allowed row
counter. Repeated retained assertions are allowed only for the exact active
connection/stage/receipt/handle/session tuple. A second begin, a clone, a
spread/copy/prototype forgery, a handle from another run, a projection clone,
a receipt from a distinct issuer, a wrong connection, a wrong stage or any
incomplete predecessor state cannot join the transfer. After source authority
has been accepted, an invalid stage attempt is terminal and burns the reserved
stage latch rather than allowing argument-by-argument probing and retry.

B1 owns one constant statement whose SHA-256 is
`032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a`.
The statement creates only `temp.ge_blr_cursor_seal`, with 30 exact columns,
STRICT and WITHOUT ROWID flags, exact stored `sqlite_schema.sql`, an exact
`pragma_table_list` shape and an exact 30-row `pragma_table_xinfo` projection.
The production hook revalidates A2b and the exact active transfer first,
requires baseline-only catalog state, executes through a captured owner
intrinsic and accepts only an adjacent `epoch + 1` and `total_changes + 0`.
Only after the exact phase-aware catalog, main catalog, reserved-object count
and repeated owner observations pass does the stage publish the seal rootpage,
mark the seal present and adopt the new live epoch.

All package-private entry hooks are captured after class construction and are
invoked as exact unbound intrinsics. Later class/prototype method replacement
cannot replace the B0b begin/fence/abort or B1 create path. TypeScript owner
epoch and row-count observations use private captured base-class snapshots;
Python uses captured exact-type owner property functions and unbound stage
helpers. The package-root APIs intentionally export none of the transfer,
session, create or assertion runtime functions.

Failure semantics were tightened through several rejected intermediate
implementations. The first cross-runtime audit rejected the candidate at HIGH
2 / MEDIUM 4 / LOW 1 because the exact B1 DDL was missing, dynamic class or
prototype hooks were replaceable, Python could lose the primary exception,
some wrong-stage attempts were not terminal, the TypeScript witness consumed
different semantics, and required hostile gates were absent. Those defects
were fixed before integration.

The revision-2 audit then found two further Python HIGH defects. A failure of
the first DDL cursor close happened after SQLite had created the table but
before the implementation recorded ownership, so cleanup could leak the seal
and the baseline reserved objects. The accepted implementation records attempt
ownership immediately after execute returns, before close; preserves the exact
primary error; removes the owned attempt; synchronizes only a proven cleanup
epoch; and refuses to report disposed while reserved objects remain. The
second defect dynamically called `self._assert_cursor_stage_transfer`, so a
later class descriptor replacement could admit a fake receipt/session. The B1
hook now invokes the module-captured exact fence, and the forged call rejects
before DDL with epoch `+0` and no seal.

Both initial remediations exposed a final cross-runtime identity problem:
after the owned CREATE, an injected rollback/rebegin could create a different
table under the same fixed name, while an unconditional catch-path DROP would
delete that replacement. The accepted cleanup is therefore generation- and
identity-bound. Immediately after CREATE it captures the exact EXCLUSIVE owner
generation, unchanged row count, positive rootpage and exact stored SQL through
captured intrinsics. A catch-path DROP is permitted only if the owner is still
the same generation with the same row count and the live table still has that
rootpage and SQL. Transaction replacement or object replacement causes cleanup
to skip the DROP, poison the stage and preserve the replacement. Disposal sees
the epoch mismatch and also refuses to delete it. Dedicated tests in both
languages perform a real owned CREATE, rollback, begin a new EXCLUSIVE
transaction, create a same-name marker replacement, throw the primary error
and prove the marker survives both catch and dispose.

The shared conformance fixture
`spec/conformance/sqlite-cursor-stage-ownership.case.json` freezes nine
top-level fields, the exact contract text, rootpage rule, eight outcome names,
17 common scenario names/outcomes, DDL/hash/stored SQL, table-list tuple and all
30 xinfo rows. Both language suites consume the normative fields rather than
merely loading the file. The scenarios cover B0 acceptance, B1 acceptance,
wrong connection/stage/receipt/session, same/different second begin, `+0`,
`+2`, unexplained writes, transaction replacement, caller DDL, catalog drift,
historical witness staleness with retained stage authority, capture-epoch
immutability and disposal behavior.

Accepted verification evidence is:

- TypeScript focused B0b/B1 suite: 31/31;
- TypeScript full SQLite package: 20 files and 464/464 tests;
- TypeScript SQLite typecheck, lint/type gate and build: green;
- Python focused B0b/B1 suite: 44/44;
- Python adjacent baseline campaign set: 609/609;
- isolated B0b/B1-only Python full suite from commit `93fbd71` plus only this
  tranche's files: 1,804 passed, two skipped and two nested subtests passed;
- current combined Python tree after the adjacent D6 compiler work: 1,815
  tests plus two nested subtests passed;
- scoped Ruff lint and formatting: green;
- strict MyPy: green over the complete current Python source set;
- shared DDL hash/cardinality and package-root non-export checks: green;
- 286 local documentation links and strict diff checks: green; and
- final independent consolidated review: HIGH 0 / MEDIUM 0 / LOW 0.

The immutable audit history is recorded in:

- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-B0-STAGE-OWNER-BRIDGE-DESIGN-2026-07-28.md`;
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-TS-B0B-STAGE-OWNER-BRIDGE-2026-07-28.md`;
  and
- `codex_logs/reviews/SQLITE-CURSOR-SLICE-B-B0B-B1-FINAL-CONSOLIDATED-AUDIT-2026-07-28.md`.

This acceptance completes B0 and B1 only. It does not implement the bounded
cursor rules 1-10, cursor paging, diagnostic publication, rebind, migration
`0002`, v2 persistence, crash/replay, scale campaigns, CLI visibility,
release readiness, adoption or any star-count outcome. Cursor Slice B remains
open. The next implementation tranche is B2: execute the bounded cursor rules
against the pristine sealed snapshot, prove the A1 root from production rows,
freeze deterministic pagination and error ordering, and retain the exact B0b
stage/session owner through every read. Publication and rebind remain a
separately reviewed later boundary.

### 31.35.12 D6 integrated-router production compiler, lowering and runtime-gate acceptance

The bounded integrated-router production tranche is now implemented and
independently accepted in TypeScript and Python. This closes the implementation
gap left by the revision-2 contract freeze: router policies and registered edge
conditions are no longer runtime-only conventions, `routedBranches` now emits
compiler-valid exact policy state, both compilers enforce the seven frozen
diagnostics, and every shared runtime vector executes on the real public
scheduler surfaces.

The compiler pass is installed after canonical capture, identity/reference,
topology, reachability and graph-policy validation, and before strict typed-
port validation. It never infers a router policy from edges or metadata. Every
router node must carry one exact direct policy in `node.config`; every claimed
`RouteEquals` edge must use the exact three-field versioned carrier. Registered
loop-pattern conditions remain opaque to D6 validation rather than being
misclassified as malformed router conditions.

The implemented diagnostic surface is:

- `GE1401_INVALID_ROUTER_POLICY` for an invalid direct router policy;
- `GE1402_UNSUPPORTED_EDGE_CONDITION` for an unregistered or malformed
  condition claimed by this registry;
- `GE1403_CONDITION_SOURCE_NOT_ROUTER` when `RouteEquals` originates from a
  non-router;
- `GE1404_ROUTE_NOT_ALLOWED` for a route case outside `allowedRoutes`;
- `GE1405_DUPLICATE_ROUTE_CASE` for a repeated route key on one router;
- `GE1406_DUPLICATE_ROUTE_TARGET` for two accepted cases targeting one node;
  and
- `GE1407_INCOMPLETE_ROUTE_COVERAGE` when a valid router is missing an allowed
  route case without a higher-priority local suppression reason.

Diagnostics are emitted by category in GE1401-through-GE1407 order. GE1401
retains node declaration order; edge-owned categories retain the complete
graph's edge declaration order, even when edges alternate between routers.
Per-router `allowed`, seen-route, seen-target and accepted-route state remains
independent, so global ordering does not merge router authority. Coverage
suppression remains local: one malformed edge or invalid router does not hide
independent diagnostics from another router or stop later typed-port passes.

Both primitive validators use exact closed keys, portable safe integers,
bounded identifiers, ordered unique routes, default/escalation membership,
single-versus-multi field rules and exact condition registry ownership. The
TypeScript package root now exports the discriminated result types and their
members together with both validator functions, so downstream declarations do
not expose an unnameable return union. The Python implementation retains the
same discriminants, paths and policy snapshot semantics in its compiler module.

The TypeScript `routedBranches` constructor now treats policy lowering as part
of graph construction rather than a later inference:

1. branch keys are normalized by the existing Unicode code-point order;
2. legacy empty classifier config synthesizes an exact single policy from that
   normalized order;
3. an explicit exact `routePolicy` is copied directly only when its ordered
   `allowedRoutes` equals all normalized branch keys;
4. an already configured exact matching policy is preserved;
5. an option plus non-empty config, invalid policy or ordered route mismatch
   throws before any graph can be returned; and
6. every generated `RouteEquals` edge remains package-owned and versioned.

The production review discovered that the frozen pattern corpus itself had
written `quick, audit` as a normalized order even though the existing canonical
constructor correctly normalizes it to `audit, quick`. Changing production to
input order would have broken the already published permutation determinism.
The shared fixture was therefore atomically corrected: all six cases now use
the real Unicode order, all successful policies/expectations match it and the
deliberate mismatch case is reversed. A new corpus-driven suite consumes all
six cases under both input permutations. Successful cases produce identical
graphs and hashes and compile successfully; error cases throw at the exact
path before graph return.

Runtime capability handling is now explicit at the graph boundary. The
compiler registry correctly accepts `LoopContinue`, `LoopDryVerdict` and
`LoopVerdictAtBound`, but the ordinary scheduler in this tranche executes only
`RouteEquals`. TypeScript ordinary execution plus durable start/resume, and
Python ordinary execution plus durable start/resume, inspect the complete
captured compiled graph before dispatch. A registered foreign condition fails
the whole run with:

- zero executor or handler calls;
- zero node attempts;
- an empty node-result projection;
- zero scheduled/completed nodes and zero observed concurrency;
- `UNSUPPORTED_EDGE_CONDITION` failures grouped in node declaration order;
- multiple messages for one source in edge declaration order; and
- no durable history read, append or other event-store side effect.

This preflight is deliberately not a compiler rejection: registered foreign
conditions belong to other graph features and must remain portable compiler
input. It is also not the historical late scheduler guard, which could execute
the source handler before discovering the unsupported edge. Multi-source
ordinary and durable probes in both languages prove the new gate runs before
all externally supplied work and that TypeScript/Python failure ordering is
identical.

The shared conformance coverage now consumes every normative area:

- all 29 policy validation cases in both language compilers;
- all 14 condition-registry cases in both language compilers;
- both envelope cases and all four host-constructed capture cases;
- all 18 compiler graphs with literal hashes and exact diagnostic projections;
- all seven runtime graphs and their literal `runtimeGraphHashes` in both
  compilers;
- the three-field `hashContract` in both languages;
- the language-specific `invalidExecutionGate` metadata and real public gate;
- all six pattern-lowering cases under both branch permutations;
- all 11 runtime cases on the TypeScript public runtime; and
- all 11 runtime cases on Python's real `try_compile_graph` plus `run_graph`
  surface, including every expected status, attempt total, output or absence,
  ordered failure code, executor call count and node terminal projection.

The first production audit rejected the tranche at HIGH 3 / MEDIUM 1 / LOW 1.
HIGH-1 was the pattern normalization contradiction and unconsumed six-case
matrix. HIGH-2 showed compiler-valid loop conditions executing a real handler
before the old scheduler reported an unsupported edge. HIGH-3 showed
TypeScript GE1404/GE1405/GE1406 grouping by router while Python retained global
edge order. MEDIUM-1 identified normative runtime/hash/gate fields, especially
all 11 Python runtime cases, that were not consumed literally. LOW-1 found the
TypeScript root validator functions exported with non-exported union types.

After those fixes, the final audit found one more documentation LOW: the
TypeScript runtime and Python README files still described compiler
exhaustiveness/default diagnostics as future work and did not document foreign-
condition preflight. Both now describe GE1401-GE1407 and the zero-execution
ordinary/durable capability gate. The documentation correction passed all 286
local-link checks and was independently reread before final acceptance.

Final accepted verification is:

- TypeScript core: 7 files and 238/238 tests;
- TypeScript patterns: 106/106 tests;
- TypeScript runtime: 12 files and 257/257 tests;
- TypeScript core/pattern/runtime typecheck, runtime build and package lint
  gates: green;
- Python D6 compiler focused suite: 14/14;
- Python public runtime corpus: 12/12;
- Python scheduler/durable/runtime-corpus related set: 109/109;
- Python complete suite after all remediation: 1,835/1,835 plus two nested
  subtests;
- scoped Ruff lint and format checks: green;
- project-standard strict MyPy: green over 54 source files;
- 73 JSON fixture validation, 286 documentation links and strict diff checks:
  green; and
- final independent production review: HIGH 0 / MEDIUM 0 / LOW 0.

The complete production audit is recorded in
`codex_logs/reviews/D6-INTEGRATED-ROUTER-PRODUCTION-FINAL-AUDIT-2026-07-28.md`.
It preserves the rejected findings, each remediation and the distinction
between the accepted project-standard MyPy gate and one non-standard explicit-
test invocation that was not counted as evidence.

This milestone completes the bounded D6 integrated-router compiler, pattern
lowering, ordinary execution and current durable integrity/preflight surface.
It does not add a dedicated durable `RouteSelected` identity, zero-rejudge
decision replay, integrated all/minimum/percentage barriers, quorum, abstention,
deadlines, late-arrival policy, cancellation propagation, barrier trace/CLI
visibility or distributed coordination. `D6-ROUTER-BARRIER-023` therefore
remains open for the barrier and dedicated durable-decision tranches. No
release, adoption or star-count outcome is claimed by this source milestone.

### 31.35.13 Cursor Slice B B2 production inspection, ten-rule diagnostics and clean pre-rebind completion execution plan

This append-only checkpoint converts the accepted B0b/B1 owner transfer and
exact TEMP-catalog foundation into the B2 implementation tranche. Its status is
`implementation-in-progress`; none of the completion, release, throughput,
adoption or popularity claims below may be inferred before every gate in this
section has passed and an independent severity-zero audit has been recorded.
The detailed cross-runtime contract is frozen in
`codex_logs/reviews/SQLITE-CURSOR-SLICE-B-B2-CROSS-RUNTIME-CONTRACT-DESIGN-2026-07-28.md`.

#### 31.35.13.1 Authority boundary and non-negotiable invariants

B2 begins only from the exact live B0b transfer object, its exact opaque A2b
receipt, the exact completed stage, the same captured connection, and the B1
`temp.ge_blr_cursor_seal` object whose rootpage, DDL, xinfo, owner epoch and
zero-row-change transition have already been proven. It does not accept a
structurally equal receipt, copied projection, reconstructed transfer, replaced
stage, new connection, stale transaction generation or caller-created same-name
TEMP relation.

The canonical authority order for every entry point is:

1. validate the opaque A2b receipt and its module-minted provenance;
2. validate the exact transfer/session/stage/connection identity graph;
3. prove the owner is still in the same live EXCLUSIVE transaction generation;
4. prove the exact main, stage, relation and B1 TEMP catalogs and rootpage;
5. prove the allowed total-change fence;
6. check cancellation at the documented boundary;
7. prepare, register, fetch and close at most one campaign cursor; and
8. publish only a fully validated terminal outcome.

B2 owns no transaction command, commit, rollback, migration 0002 execution,
permanent write, cursor rebind, rules 11/12, publication verifier, CLI or public
API. The reconciliation registry's `implementationClaim`, `releaseGate`,
`productionThroughputClaim` and `cursorSeal.protocolClaim` remain false. The
registry's deferred whole-protocol empty-root status is intentionally not
rewritten merely because private A1 roots are already accepted.

#### 31.35.13.2 Cross-runtime conformance artifact lane

The main/spec lane adds a closed
`spec/conformance/sqlite-cursor-pre-rebind-v1.case.json`, its closed JSON Schema,
an executable validator and hostile `node:test` suite. The fixture freezes:

- claims and explicit nonclaims;
- diagnostic bounds 1 through 64 with default 16;
- one-row source and seal fetch discipline;
- BLOB bounds, safe-integer bounds and page-size bounds;
- exact rule order `BLR_CURSOR_AUTHORIZATION` through
  `BLR_CURSOR_CHECKPOINT_BINDING`;
- the accepted A1 domains, canonical carrier order and literal empty, event,
  checkpoint and cross-order roots;
- normalized source, insert, seal and ten marker SQL strings plus literal
  lowercase SHA-256 values;
- portable EQP acceptance and forbidden-plan predicates;
- closed clean and diagnosed outcomes;
- pristine, isolated hostile, aggregate hostile, lifecycle and limit-boundary
  cases; and
- exact TypeScript/Python parity gates.

Unknown fields, duplicate JSON keys, reordered normative arrays, wrong hashes,
computed rather than literal expectations, unsafe integers, over-limit bounds,
tenant-controlled diagnostic fields, receipt/root placeholders in diagnosed
outcomes, accidental release claims and mutation of the existing whole-protocol
registry are validator failures.

The fixture must be immutable input to both runtime lanes. Runtime code cannot
edit the fixture to match an implementation. If either runtime contradicts a
literal, the runtime or a separately reviewed fixture erratum must be fixed
atomically; silently weakening the validator is forbidden.

#### 31.35.13.3 Bounded permissive inspection layer

The strict A1 physical decoder remains unchanged as the seal primitive, but it
must not run first on hostile production rows because doing so would steal
rule-owned diagnostics. Each runtime therefore adds a closed permissive B2
inspection result with:

- twenty sanitized scalar/digest/identity TEMP values;
- the nine per-row flags `authorization_ok`, `scope_ok`,
  `blobs_canonical_ok`, `position_ok`, `clock_ok`, `catalog_ok`, `shape_ok`,
  `event_binding_ok` and `checkpoint_binding_ok`;
- `seal_eligible`, true only when every A1 precondition and every applicable
  per-row flag is true; and
- an optional already-validated A1 row/carrier retained only until its TEMP
  insert completes.

The inspector first validates 18-column physical arity and SQLite storage
classes without coercion. Both raw BLOBs are byte-length-bounded before fatal
UTF-8/JSON decoding; BOM, duplicate object keys, nonportable constants, unknown
closed-object fields and noncanonical byte representations are rejected. It
retains only safe lengths and lowercase SHA-256 digests in TEMP. Raw BLOB bytes,
decoded JSON and tenant-controlled fragments are released before the next
source fetch and never appear in exceptions or diagnostics.

Representable hostile rows are staged with fixed module-private sentinels and
their owning flags false so later independent rules remain observable. A row
without a unique bounded tenant/token stage key increments bounded pre-stage
rule-1/rule-8 evidence and makes the run terminal diagnosed; it is never
silently dropped, converted to null or included in the seal.

Peak live application state is bounded to one physical source row, one decoded
scope, one decoded snapshot, one inspection result, one TEMP insert parameter
tuple and constant-sized counters/accumulator state. `.all()`, `fetchall()`,
`Array.from`, proportional list/tuple/map retention, application sorting and
decoded snapshot retention are forbidden by review and scale probes.

#### 31.35.13.4 Source scan and exact TEMP insertion

The source scan uses the already frozen exact 18-column projection in main
primary-key order `tenant_id COLLATE BINARY, token_hash COLLATE BINARY`. It is a
single forward cursor with no OFFSET and no collection materialization. Before
and after prepare, every fetch, inspect, insert and close boundary, the campaign
re-proves its registered cursor ownership, transaction epoch, EXCLUSIVE mode,
catalog identity and permitted change count.

One representable source row produces exactly one 30-column insert in B1 xinfo
order. Each insert must report exactly one row change, advance connection
`total_changes` by exactly one and advance the stage-owned allowance by exactly
one. Zero, multiple, hidden-trigger, caller DML or unaccounted TEMP/main changes
poison the campaign. Prepare/bind/execute/reset/close failures retain the first
authoritative exception and execute only identity-safe cleanup.

Counters separately retain captured-main count, walked-source count, staged
TEMP count and the accepted A2b expected count. Rule 7 owns only inventory
loss/duplication between main/source/TEMP counts. It does not count
`seal_eligible` rows, because malformed rows are already owned by their field
rules. Equal-count delete/insert substitution is detected later by exact A1
root/authority comparison and is terminal stale authority, not mislabeled rule
7 or future rule 12.

#### 31.35.13.5 Exact ten-rule execution

Rules execute unconditionally in frozen registry order after the source cursor
has been finalized and its ownership cleared. Each row rule prepares fixed SQL,
binds exactly `diagnosticLimit + 1`, registers the sole active cursor, validates
each marker as the one-column integer tuple `(1)`, counts no more than the
plus-one bound, clears stage ownership before the sole close, then performs the
next owner/catalog/change fence.

1. `BLR_CURSOR_AUTHORIZATION` owns invalid tenant/token identifiers and invalid
   lowercase-64 principal/authorization hashes without token plaintext.
2. `BLR_CURSOR_SCOPE` owns event/checkpoint null groups and exact decoded
   request-scope tuple disagreement.
3. `BLR_CURSOR_BLOB_CANONICAL` owns BLOB bounds, UTF-8/JSON, duplicate-key,
   nonportable and canonical-byte violations.
4. `BLR_CURSOR_POSITION` owns page/position bounds, event tail bounds and
   checkpoint decoded-array bounds.
5. `BLR_CURSOR_EXPIRY_CONSUMPTION` owns safe cursor clocks, strict expiry,
   consumption ordering and frozen provider-high-water relations; expiry is
   not itself a provider-observation high-water.
6. `BLR_CURSOR_CATALOG_BINDING` owns per-row descriptor/schema disagreement;
   actual DDL/catalog replacement remains terminal corruption.
7. `BLR_CURSOR_SEAL_COUNT` emits exactly one inventory unit when captured main,
   walked source and TEMP counts disagree.
8. `BLR_CURSOR_SHAPE` owns physical arity/storage/null/lexical shape not already
   assigned to a more specific semantic rule.
9. `BLR_CURSOR_EVENT_BINDING` owns exact snapshot-tail mismatch and missing
   retained `(tenant, stream, sequence, hash)` history while allowing later
   valid appends.
10. `BLR_CURSOR_CHECKPOINT_BINDING` owns missing/mismatched historical `put`
    summaries and ordering other than sequence descending, creation descending,
    checkpoint ID ascending while allowing later current mutation/deletion.

Each row contributes at most once to a given rule but may contribute to several
independent rules. Only nonzero diagnostics are returned, exactly as
`{ruleId, violationCount, diagnosticsTruncated}` in registry order. The count is
`min(actual, limit)` and truncation is true exactly when actual exceeds the
limit. Diagnostic output cannot contain tenant, token, hash, SQL value, payload,
snapshot, exception fragment or an unregistered field.

#### 31.35.13.6 A1 reproduction and terminal outcome state machine

The seal projection runs only when all ten diagnostics are zero. It selects the
twenty sanitized carrier/identity columns with `seal_eligible = 1`, ordered by
token hash then tenant using BINARY collation. Each row is reconstructed through
the existing A1 carrier validation and appended to the existing constant-space
accumulator; B2 must not implement a second serializer, row digest, chain or
terminal hash.

Clean completion requires, in order:

1. source cursor final and unregistered;
2. every insert and count fenced;
3. all ten rule cursors final and unregistered;
4. source/main/TEMP catalogs, rootpage, owner epoch and allowed changes re-proven;
5. provider clock high-water re-read and exactly equal to A2a capture evidence;
6. fresh A1 count/root exactly equal to the retained A2b receipt;
7. exact source identities, projection reference, source-summary reference,
   receipt, transfer and session object graph re-proven;
8. the non-consuming A2b provenance fence repeated;
9. the same receipt object stored without cloning or reissuing; and
10. an atomic one-way transition from `active` to `pre-rebind-complete`.

The private outcome union has only:

- `pre-rebind-complete`: exact projection object, empty diagnostics and the
  exact input receipt object; or
- `diagnosed`: exact projection object, immutable safe diagnostics and the
  literal ten-count vector, with no receipt, root, seal or null placeholder.

The stage/campaign state machine is
`unused -> active -> pre-rebind-complete | diagnosed | poisoned`. Diagnosed and
clean outcomes are terminal. Second completion, second run, receipt
substitution, transfer substitution, abandonment reuse, cancellation reuse or
retry on the same stage is terminal. Retry begins from a new caller-owned
transaction, source capture, A2b receipt, TEMP stage and campaign graph.

#### 31.35.13.7 Resource ownership, cancellation and exception precedence

At most one source, seal, rule or EQP cursor is registered at a time. Ownership
is transferred immediately after prepare, verified around every fetch, cleared
before the sole close and finalized by one shared idempotent path used by normal
completion, abort, poison and dispose.

A close error without an earlier primary becomes authoritative and poisons the
stage. With an existing primary, close/drop failures are suppressed after
best-effort exact-identity cleanup. Name-only cleanup is forbidden after owner
generation, rootpage or exact SQL identity becomes uncertain. A closed
TypeScript connection clears only in-memory ownership; connection teardown owns
TEMP destruction. Python captures unbound class intrinsics and hardens property
access so a closed connection cannot mask the initiating error.

Cancellation is polled before begin; before/after source prepare and fetch;
before/after inspect and insert; before/after every rule prepare/fetch/close;
before seal prepare/fetch/close; and before terminal publication. Cancellation
after a real diagnostic remains terminal and does not publish a partial/stale
diagnosed outcome. The precedence is A2b authority, transfer/session, owner
epoch/EXCLUSIVE mode, catalog, statement/EQP/marker shape, cancellation, then
cleanup; diagnostic data is not an exception.

#### 31.35.13.8 Query-plan and boundedness evidence

Both runtimes normalize and hash the exact source, insert, seal and marker SQL.
EQP acceptance requires the main cursor primary-key scan, the sole TEMP target
write, TEMP WITHOUT ROWID primary-key scan, constant-row rule-7 plan, exact
event-history covering lookup and exact bounded checkpoint-history lookup.
Plans containing `AUTOMATIC`, `MATERIALIZE`, `USE TEMP B-TREE`, `CO-ROUTINE`, an
unbounded sorter or an unexpected relation/index fail. No guessed
`sqlite_autoindex_*` name is frozen.

Fast characterization runs exact 128 and 1,024 cursor populations whose tenant
and token orders conflict. Evidence records source/TEMP/seal counts and root,
maximum live raw/decoded rows, fetch size, active cursor count, TEMP object/page
counts and normalized EQPs. This gate proves bounded correctness only. Exact
10K/100K scheduled stress, latency percentiles, RSS/TEMP-file behavior,
subprocess crash/replay and `productionThroughputClaim:true` remain later
checkpoints.

#### 31.35.13.9 Parallel delivery lanes and merge order

Four non-overlapping lanes run at maximum available concurrency:

1. shared contract lane owns only the B2 fixture/schema/validator/test under
   `spec/conformance`;
2. TypeScript lane owns the private cursor campaign/inspection implementation,
   narrowly required stage/cooperation hooks and focused/lifecycle tests under
   `packages/sqlite`;
3. Python lane owns the mirrored private implementation/hooks/tests under
   `python`;
4. main integration/audit lane owns this append-only plan, task log, cross-
   runtime comparison, full gates, severity audit and commit/push discipline.

Merge order is: fixture validator green; runtime fixture consumption initially
red; TypeScript and Python independently green; exact cross-runtime parity;
fault/lifecycle/scale gates; adjacent and full suites; static/package/docs
gates; independent hostile review; remediation; final HIGH 0 / MEDIUM 0 / LOW
0 acceptance. No lane commits independently and no lane edits another lane's
files without explicit handoff.

#### 31.35.13.10 Required red tests and final acceptance matrix

Before claiming implementation, both runtimes must prove pristine empty, event,
checkpoint, cross-order, duplicate-token-across-tenant, page boundaries,
consumed, expired-but-valid, later-event-append and later-checkpoint-current
mutation cases. Hostile tests isolate every rule, exercise every truncation
boundary 1/2/16/17/64/65, combine all ten rules in nonlexical input order and
attack equal-count substitution, catalog/index replacement and cloned authority.

Lifecycle injection covers source/seal/rule statement creation; first, middle,
final and terminal fetch; every close; decode-before-insert; insert zero/+2;
post-row/pre-count; every rule transition; malformed marker; post-diagnostic
mutation; transaction end; rollback/rebegin; active dispose; closed connection;
every cancellation poll; cleanup-only; primary-plus-cleanup; second run and
abandonment. Each injected failure asserts cursor ownership clearance, stage
terminal state, primary-error precedence, unchanged permanent data and no
receipt/root leakage.

Acceptance requires all B2 fixture cases consumed literally by both runtimes;
exact SQL/hash/root/vector/outcome parity; focused and adjacent SQLite/Python
suites; complete SQLite and Python suites; TypeScript typecheck/lint/build;
Ruff lint/format; project-standard strict MyPy; all conformance validators;
54-rule registry nonclaim checks; documentation links; package-root nonexport
checks; strict diff checks; clean ownership scoping; and an independent audit
with no unresolved HIGH, MEDIUM or LOW finding.

Only after those gates may this section receive a separate append-only
acceptance checkpoint and a valid milestone commit/push by
`reacher-z <mtrxcop@gmail.com>` with no coauthor trailer. Even then, B2 means
only exact production v1 cursor inspection, rules 1-10, deterministic safe
diagnostics and clean `pre-rebind-complete` evidence. B3 publication/rebind,
rules 11/12, release hardening, performance/crash proof, community adoption and
the 5K/6K-star objective remain open work rather than source-code claims.

#### 31.35.13.11 B2 staging and rule-7 interpretation clarification

This append-only clarification resolves the implementation-review ambiguity
between a representable malformed row and a physically nonstageable row. An
otherwise valid SQLite TEXT tenant/token value whose original text exceeds the
bounded diagnostic key size is representable: both runtimes replace that value
with a deterministic, source-ordinal-qualified internal sentinel, insert one
unique TEMP row and attribute the semantic failure to rule 1 only. The sentinel
is never emitted, sealed or exposed to a caller.

A physical row whose arity, key storage class or key identity cannot yield a
unique bounded stage key is nonstageable. It increments the bounded pre-stage
rule-1 and/or rule-8 evidence, increments the walked-source count, performs no
TEMP insert and therefore may independently trigger rule 7 because the real
walked and real TEMP counts differ. The implementation must not add a logical
pre-stage count to the physical TEMP count merely to suppress that evidence.
The statement that an explained semantic failure must not manufacture rule 7
applies to a row that was successfully staged with `seal_eligible = 0`; it does
not redefine a nonstageable physical row as present in TEMP. A pure isolated
rule-8 storage-class case must use a representable non-key field; a key-storage
failure is expected to produce the applicable rule-1/rule-8 evidence plus the
independent physical rule-7 count mismatch.

#### 31.35.13.12 Cursor Slice B2 accepted implementation checkpoint

The bounded internal Cursor Slice B2 production tranche is accepted for the
scope frozen by sections 31.35.13.1 through 31.35.13.11. TypeScript and Python
now implement the same private permissive physical-row inspector, exact
stage-owner campaign, ten ordered diagnostic rules, bounded plus-one
diagnostics, one-cursor ownership discipline, exact SQL/catalog/EQP fences,
cancellation and failure precedence, A1 accumulator reuse, and the two closed
terminal outcomes `pre-rebind-complete` and `diagnosed`.

The canonical fixture is
`spec/conformance/sqlite-cursor-pre-rebind-v1.case.json`. Its canonicalized
contract SHA-256 is
`6acb99d9593b37d6e29b6862531e3ade2dae051b21a628a26cc4e1d7e2fdb8bc`.
This is the fixture's self-excluding canonical contract digest, not a claim
about its raw file-byte hash. The fixture freezes ten rules, five semantic
vectors, 15 exact SQL contracts and 70 execution obligations partitioned as
12 pristine, 27 hostile and 31 lifecycle cases.

The executable registry consumed all 70 cases literally in each runtime with
no missing, unexpected, duplicate or OPEN evidence:

- common sorted case-ID digest:
  `bcf1f08d9bc53647466d8dcb7e7d5a6833447da01ad1cd08c2510ba82fd1d067`;
- TypeScript: 70/70 cases and 261/261 exact execution IDs, digest
  `0c85e3176c5b25a0cf973a0d92da536924f5a79efc2275e4f354b77af23a38aa`;
- Python: 70/70 cases and 302/302 exact execution IDs, digest
  `7e50c85e616e2371e38178be2bcddc4388050745491251ebb1408148cfb760f1`;
- group digests: pristine
  `2dd908834ac6df709656bf45a9be3c3586379145116b220a0ec3b653bde36dee`,
  hostile
  `f2d27053b760e7ad5fd9f116501fd8372e2f5a2c8957762bf68d3802f6d5e9c0`
  and lifecycle
  `914005cc51f337e3e556047fb169adff49896d04c795ddf9990d09bc7c28407d`;
- final executable-coverage duration: 970233 ms; and
- strict parity: `parityDifferences: []` and `remainingEvidence: []`.

The deterministic cross-runtime harness separately compares five semantic
roots, eleven isolated/aggregate hostile rule cases, two nonstageable pre-stage
cases and one mixed storage/semantic case. It reports 19 executed harness
cases, 24 representable stage tuples, two pre-stage tuples, five carrier row
digests and zero TypeScript/Python difference. Harness-derived evidence remains
separate from the 70-case executable registry and reports zero direct lifecycle
cases rather than pretending to replace the 31 exact lifecycle obligations.

Production characterization completed for conflicting tenant/token orders at
128 and 1,024 rows. The exact A1 roots are respectively:

- 128 rows:
  `fc3699d41e2c4c9b0f45aa6c2afc1cfcbb7a89d1476420995427dd827bac9e32`;
- 1,024 rows:
  `9ad8d233c1f4d4717c126a9cf3aeb89675a3ddb15682e68b230c6fbec3e9e9a2`.

Each characterization accepted all 15 EQP statements with provenance
`in-campaign-registered-cursor`. Each runtime observed exactly one event and
one checkpoint point lookup, maximum fetch/raw/decoded/carrier/registered-
cursor/nested-point state of one, and zero final active cursor or retained
application row. TEMP object evidence is no longer a constant: both campaigns
measured `temp.sqlite_schema` at three lifecycle points under provenance
`in-campaign-temp-schema-scalar`, observed current/final/maximum/external object
count one, and matched the exact population in TEMP. TEMP page counts remain
environment observations and are not frozen as cross-runtime identities.

Independent audit history is preserved rather than rewritten as first-pass
success. Earlier reviews found catalog-identity, lookup-marker, exception-
precedence, ownership-registration, lifecycle, row-liveness and executable-
coverage gaps. Later differential review found and closed mixed storage/
semantic divergence, a valid-token/sentinel collision, dishonest pre-stage
harness attribution and an ineffective timeout hierarchy. The final hostile
passes additionally closed real TEMP measurement, captured Python close,
outer-abort primary preservation against registry faults, diagnosed authority
retirement, bounded catalog fetch, captured TypeScript SQL/owner/epoch fences,
closed-connection error normalization and complete subprocess diagnostics plus
process-tree cleanup on POSIX and Windows.

One full-suite failure was intentionally retained in the audit trail: after
diagnosed authority retirement, an old Python aggregate test still expected
the obsolete stage-binding/poison behavior. The test was corrected to assert
the actual closed contract: the retired transfer fails at the provenance
boundary while the stage remains `open` with B2 terminal `diagnosed`. A
TypeScript full-suite pass also exposed raw Node `ERR_INVALID_STATE` from a
captured closed-connection snapshot; the runtime now preserves the structured
`GE_CYCLE_STORE_UNAVAILABLE / inspect-schema / SQLite provider is closed`
primary while campaign abort owns poison and cleanup.

The strict-gate flake audit found that the 1,024-row TypeScript production test
normally consumed roughly 24 seconds under a 30-second local budget. Its local
budget is now 90 seconds, strict Vitest defaults to 30 seconds, and the nested
20/35/60/90/120-minute child/coverage/step/job hierarchy remains bounded.
Failure reports preserve status, signal, system error, stdout, stderr, failed
test messages and file/suite messages. Timed-out children run in isolated
process groups and receive process-tree cleanup, including Windows `taskkill
/t /f` fallback.

Section 31.35.13.7's phrase “Cancellation is polled before begin” is clarified
append-only. “Begin” means the first B2 operational work boundary `run:start`,
after mandatory A2b provenance, transfer/session, exact stage and owner-
authority construction. It does not mean cancellation may preempt or mask
constructor authority validation. Pre-requested cancellation is observed
before source/EQP/work begins, while forged provenance, transfer, session,
stage, owner epoch or catalog authority retains higher precedence.

Final regression evidence is:

- TypeScript SQLite: 22 files and 836/836 tests;
- Python full tree: 2,234/2,234 tests;
- workspace TypeScript build, typecheck and lint green;
- Ruff lint over Python implementation/tests and the B2 plugin, B2 format
  checks and strict MyPy over 54 Python source files green;
- 75 JSON fixtures and 36 case manifests validated;
- 286 documentation links validated;
- SQLite ledger/contract gate 27/27;
- package-content validation for eight npm packages;
- Python artifact inventory/install smoke with 68 wheel entries and 69 sdist
  entries; and
- scoped diff/whitespace, package privacy and append-only plan checks green.

The final independent post-remediation disposition is HIGH 0 / MEDIUM 0 / LOW
0. This checkpoint authorizes a scoped milestone commit and push by
`reacher-z <mtrxcop@gmail.com>` without a coauthor trailer.

Acceptance remains deliberately narrow. B3 publication/rebind, rules 11 and
12, migration `0002`, permanent v2 publication, 10K/100K scheduled stress,
latency/RSS/TEMP-file proof, subprocess crash/replay, release hardening, stable
release, community adoption and the 5K/6K-star objective remain open. No source
change can guarantee a future star count, and this checkpoint makes no such
claim.

### 31.36 Runtime capability truth, public compatibility and next execution queue

This append-only section records the highest-priority tranche selected after
Cursor Slice B2. It does not revise or weaken any prior obligation. It closes a
dangerous execution ambiguity in the wider Graph IR, records the compatibility
work needed to land the boundary honestly, and fixes the next parallel order.

#### 31.36.1 Whole-plan truth snapshot and explicit non-completion

The new full-plan scan counted 107 registered tasks: 41 complete, seven in
progress and 59 planned. The evidence scanner found 13 of 77 evidence groups
satisfied and 64 open. All 178 release leaves are mapped but all 178 remain
open; the release-candidate overlay is 0 of 93. These counts are a planning
snapshot, not a release or product-completeness claim.

The 21-day plan, release candidate, stable release, community adoption and
5K/6K-star objectives remain incomplete. Source quality can improve adoption
probability but cannot guarantee a future GitHub star count. The goal stays
active.

Major open domains remain the complete compiler/kernel; D6 barrier settlement
and durable route-decision identity; D7 scheduler/controller integration; D4
subgraph/state/artifact/stream/trace; D9 runtime redaction; budgets, model
routing and providers; verifier/judge/citation and isolation; complete CLI/MCP,
OTel and Explorer; ten executable patterns; the fourteen-step course; release
provenance/usability/community work; and SQLite B3, rules 11/12, migration
`0002` and permanent v2 publication.

#### 31.36.2 Failure that made this tranche mandatory

Graph IR recognizes vocabulary ahead of the first native DAG scheduler. Before
this tranche, a compiler-valid document could request state, subgraph,
verifier, human, streaming, artifact, mapping, resource, isolation, jitter,
dynamic-growth, deadline, cost or extension-policy behavior and then reach a
scheduler that treated it as ordinary DAG value flow. A generic executor could
make an unsupported node appear successful without its specialized semantics.

Compilation success is not an execution claim. A runtime must execute the exact
declaration or reject it before work. Silent semantic downgrade is forbidden.
The `runtime-capability/v1alpha1` boundary therefore applies identically to
ordinary execution, durable start and durable resume in TypeScript and Python.

#### 31.36.3 Closed supported subset

The schedulers may execute only:

1. `agent`, `model`, `tool`, `transform` and compiler-validated integrated
   `router` nodes;
2. static all-success `barrier` nodes with exactly `{}` or exactly
   `{ "condition": "all" }` config;
3. omitted or explicit `value` edge mode;
4. retry jitter absent or false;
5. `maxConcurrency`, `maxDepth`, `maxFanOut` and `maxTotalAttempts`; and
6. the compile-only `graphengineering.reacher-z.github.io/typed-ports`
   extension.

Graph, node and edge schemas remain compiler contracts. Their presence does
not claim runtime validation of graph inputs, node inputs/outputs, edge values
or graph outputs.

#### 31.36.4 Closed rejected subset and stable labels

Every present unsupported declaration produces one failure:

- `stateSchema` -> `graph-state`;
- `subgraph`, `validator`, `human` -> `node-kind:<kind>`;
- non-static-all barrier config -> `node-config:barrier`;
- cache -> `node-cache`;
- resources -> `resource-admission`;
- isolation -> `isolation-provider`;
- true jitter -> `retry-jitter`;
- edge map -> `edge-map`;
- stream/artifact-reference mode -> `edge-mode:<mode>`;
- `maxDynamicNodes` -> `dynamic-graph-patch`;
- `maxDurationMs` -> `graph-deadline`;
- `maxCostUsd` -> `cost-budget`; and
- remaining policy keys -> `policy:<key>`.

Presence is authoritative for cache, resources, isolation and map, even when
the value is `{}`. Empty and non-empty schemas remain compile-only and do not
create capability failures.

#### 31.36.5 Deterministic zero-side-effect failure contract

The exact code is `UNSUPPORTED_RUNTIME_CAPABILITY`. The exact message is:

```text
Runtime capability '<capability>' at '<path>' is not implemented by runtime-capability/v1alpha1
```

Paths are RFC 6901 JSON Pointers. Dynamic segments escape `~` as `~0` and `/`
as `~1`. Graph/policy failures are attributed to the first entrypoint, node
failures to that node and edge failures to the source. Attribution never creates
a node result.

Order is graph state; nodes in declaration order with kind, barrier config,
cache, resources, isolation and jitter order; edges in declaration order with
map before mode; known dynamic/deadline/cost policies; then remaining policy
keys in Unicode code-point order. Runtime-capability failures precede existing
`UNSUPPORTED_EDGE_CONDITION` failures when both occur.

Unsupported graphs return `failed`, zero nodes, zero attempts, zero observed
concurrency, no output and empty scheduled/completion orders. No executor or
ordinary journal hook runs. Durable start/resume perform zero store reads and
writes. Ordinary preflight happens before graph-input inspection, so a hostile
input cannot mask or bypass the graph capability result.

#### 31.36.6 Literal conformance corpus and validator

`spec/conformance/runtime-capability.case.json` is the single source consumed
literally by both runtime suites. Its schema, semantic validator, Node test and
prose contract freeze seven cases:

1. supported core plus a two-level static all-success barrier;
2. state rejection while non-empty graph schemas are accepted;
3. unsupported subgraph/validator/human kinds;
4. unsupported barrier policy;
5. cache/resource/isolation/jitter rejection while node schemas are accepted;
6. map/stream/artifact-ref rejection while edge schema is accepted; and
7. known and unknown policy rejection.

The policy case freezes empty key, `__proto__`, `constructor`, ASCII, accented
Unicode and supplementary emoji ordering plus slash/tilde pointer escaping.
The seven cases contain exactly 22 expected failures.

The validator independently checks unique node identity, entrypoint/output/edge
endpoints, entrypoint incoming-edge prohibition, reachability, acyclicity,
longest-path depth and fan-out bounds. This closes the audit-proven blind spot
where a two-level graph with `maxDepth: 1` passed schema validation but failed
both native compilers. Both literal runtime suites still compile every case as
redundant compiler-semantic evidence.

#### 31.36.7 Public compatibility and truthful showcase policy

The canonical quickstart, TypeScript CLI template and Python bundled template
remove `maxDynamicNodes: 0`, remain byte-identical and compile to
`f9aaeffc991e6cec223c959dbf7737a8fff96e1eb1ea433343f45fe663697b50`.
Python CLI doctor/init use that exact hash. Fresh-clone documentation builds the
ignored TypeScript CLI `dist` before invoking validate/plan/visualize.

The pattern showcase preserves the original `verifiedFanout` graph, first proves
that its three specialized validator nodes fail closed with zero attempts, then
builds a topology-equivalent execution projection changing only those kinds to
`transform`. It records distinct declaration/execution hashes, proves three-way
overlap and exact adjudication, and therefore demonstrates mechanics without
claiming verifier semantics.

The report uses `notExecutedByShowcase`, not `declarativeOnly`. It records
`runtimeCapabilityAvailable: true` for `routedBranches` because `RouteEquals` is
integrated, and false for loop early-stop. ROADMAP, concepts, failure modes,
security, both runtime READMEs and pattern docs must distinguish static joins
from quorum/deadline barriers, RouteEquals from arbitrary/durable decisions,
compile-only schemas from runtime validation, and fail-closed resource/isolation
declarations from actual isolation.

#### 31.36.8 Parallel delivery and audit history

Four non-overlapping lanes operate at maximum available concurrency:

1. main/spec owns shared contract, corpus, public compatibility, append-only
   plan/log and integration;
2. TypeScript owns runtime preflight, ordinary/durable wiring and tests;
3. Python owns mirrored runtime wiring, literal tests, template identity and
   Python gates; and
4. hostile read-only audit attacks ordering, zero I/O, compiler validity,
   quickstarts, showcase and documentation truth.

Agents do not commit independently. Main monitors findings and sends every
boundary correction back to both implementations. The audit history is kept:
initial schema/barrier over-rejection, combined-condition drift, hostile-input
precedence, invalid fixture depth, template/hash drift, generic verifier
execution, stale route/security wording, missing fresh-clone CLI build and the
semantic-validator blind spot were all found, repaired and retested.

#### 31.36.9 Acceptance gates

Acceptance requires the shared 7-case/22-failure validator and test; literal
ordinary/durable consumption in both runtimes; combined-condition and hostile-
input precedence; zero executor/journal/store effects; TS runtime full tests,
build/typecheck/lint; Python focused and full tests, Ruff format/lint and strict
MyPy; CLI tests and template/hash/doctor/init parity; fresh-clone CLI commands;
JS/Python quickstarts with concurrency two; pattern showcase with validator
gate plus transform projection and concurrency three; all fixtures; doc links;
scoped diff checks; and independent HIGH 0 / MEDIUM 0 / LOW 0 disposition.

Only after every gate is green may a separate append-only checkpoint authorize
a scoped commit/push by `reacher-z <mtrxcop@gmail.com>` without coauthor.

#### 31.36.10 Explicit non-claims

This tranche does not implement runtime schema validation, state reducers,
subgraphs, validators, human approval, settled/minimum/percentage/quorum/
deadline barriers, cache, admission, isolation, jitter, edge maps, streams,
artifacts, dynamic patches, deadlines, cost accounting or arbitrary extensions.
It prevents those declarations from silently executing as weaker behavior.

It also does not complete durable `RouteSelected`, B3, rules 11/12, migration
`0002`, stable release, community adoption or any star objective.

#### 31.36.11 Next maximum-parallel execution queue

After this checkpoint:

1. return to SQLite B3 publication/rebind and rules 11/12, then migration
   `0002` and permanent v2 state with crash/cancellation/replay proof;
2. in parallel where ownership permits, freeze D6 settled-barrier and durable
   `RouteSelected` event/checkpoint/replay identity;
3. integrate the standalone D7 controller only after revision/lease/patch
   visibility/recovery authority is closed;
4. implement D4 subgraph/state/artifact/stream/trace one contract at a time;
5. implement D9 redaction/protected persistence/sink gates before safe capture
   or observability claims;
6. close provider/model/budget/verifier/isolation/CLI/MCP/OTel/Explorer families
   under the same fail-closed rule;
7. expand the ten patterns and fourteen-step course only from earned runtime
   evidence; and
8. run release, install, usability, external-user and community programs without
   converting forecasts into completion claims.

Each future feature removes only its own rejection after versioned contract,
TypeScript and Python behavior, durable recovery, hostile tests, public docs and
independent audit are accepted. Compiler validity alone never authorizes an
allow-list expansion.

#### 31.36.12 Runtime capability truth accepted implementation checkpoint

The `runtime-capability/v1alpha1` tranche is accepted for its deliberately
narrow scope. TypeScript and Python now reject every frozen unsupported
declaration before ordinary work or durable store I/O, preserve the current
static all-success barrier and integrated RouteEquals behavior, accept schemas
only as compile-time contracts, and emit the exact same owners, paths, messages
and order.

The final shared corpus contains seven cases and 22 exact failures. It includes
empty, prototype-named, constructor-named, accented and supplementary-plane
policy keys plus RFC 6901 escaping. The semantic validator has a direct red test
proving that the former `maxDepth: 1` regression is rejected. Both runtimes
consume the literal JSON for ordinary and durable execution; combined runtime
and foreign-condition failures preserve runtime-first ordering; unsupported
durable start/resume perform zero reads and appends.

Public compatibility is closed. The three quickstart graph copies are byte-
identical and use canonical hash
`f9aaeffc991e6cec223c959dbf7737a8fff96e1eb1ea433343f45fe663697b50`.
Fresh-clone CLI build/validate/plan/visualize passes. JavaScript and Python
quickstarts both succeed with observed concurrency two. The pattern showcase
proves specialized validator rejection before running its explicit transform
projection, records distinct hashes, and succeeds with observed concurrency
three. Routing is no longer mislabeled declarative-only.

Final executable evidence is:

- TypeScript runtime: 12 files, 265/265 tests;
- Python: 2,185/2,185 non-CLI tests plus 52/52 CLI tests, 2,237 unique tests;
- Python focused runtime/capability regression: 170/170;
- TypeScript workspace build, typecheck and lint over eight packages;
- Python Ruff format/lint and strict MyPy over 56 source files;
- TypeScript CLI: 147/147 tests;
- fixtures: 77 JSON files, 37 case manifests and all seven capability cases;
- documentation: 287 local links;
- npm package-content validation: eight packages;
- JavaScript/Python quickstarts and pattern showcase;
- scoped diff/whitespace and append-only plan checks; and
- final independent disposition HIGH 0 / MEDIUM 0 / LOW 0.

This checkpoint authorizes one scoped milestone commit and push by
`reacher-z <mtrxcop@gmail.com>` without a coauthor trailer. It does not authorize
a whole-plan, release, schema-validation, specialized-barrier, verifier,
isolation, adoption or star claim. The next queue remains B3 plus D6 contract
work as specified above.

### 31.37 SQLite Cursor B3 atomic publication/rebind contract freeze and execution expansion

This section is append-only and does not alter any preceding requirement. It
resolves the ambiguity discovered after the accepted capability-truth tranche
and turns `SQLITE-CURSOR-B3-PUBLICATION-REBIND` into an executable, hostile-
validated contract before either runtime receives permission to mutate a v1
database permanently. Its current development status is `contract-frozen,
runtime-not-implemented`. It makes no active-manifest, implementation,
protocol, release, throughput, adoption, popularity or star-count claim.

#### 31.37.1 Evidence-based boundary correction

Three earlier readings of the work queue could have produced incompatible
implementations: cursor rebind before `0002`, a standalone B3 migration that
executes and commits `0002`, or cursor rebind as a subprotocol of the complete
one-commit v1-to-v2 migration. Only the third interpretation preserves the
already-frozen atomicity and reopen requirements.

B3 is therefore a private cursor subprotocol inside the outer v1-to-v2 atomic
migration. It owns neither `BEGIN EXCLUSIVE`, `COMMIT`, `ROLLBACK`, migration
`0002`, baseline entry/header/sequence publication, lineage, schema metadata,
descriptor metadata nor the final publication audit. It cannot produce an
accepted permanent intermediate state. The outer migration owns one live
exclusive transaction generation and exactly one successful commit.

The normative sequence has nineteen ordered stages:

1. prove the source v1 database is semantically valid;
2. complete B2 and retain its exact opaque receipt and private stage;
3. mint the outer publication authority;
4. execute the manifest-bound `0002` catalog rebuild;
5. capture and adopt the exact post-`0002` catalog fence;
6. stream permanent baseline entries;
7. publish the final baseline header;
8. publish the operation-sequence singleton at zero;
9. derive the cursor publication session;
10. execute the single fixed cursor rebind once;
11. accept `BLR_CURSOR_REBIND_COUNT`;
12. accept `BLR_CURSOR_SEAL_MISMATCH` against fresh main-table evidence;
13. transition the exact private stage to `cursor/clock-complete`;
14. publish migration lineage;
15. publish final schema and descriptor metadata;
16. accept the three publication rules;
17. prove catalog equality with a fresh v2 database;
18. accept every physical and semantic postcondition; and
19. commit once.

Every injected failure before step 19 must reopen as the exact source v1
logical and physical state. Once commit returns, reopening must observe only a
complete target v2 and run the complete-v2 audit. A commit-returned path may not
claim rollback merely because later process cleanup fails.

#### 31.37.2 Frozen source, target and migration identities

The source identity tuple is:

- schema version `1`;
- provider descriptor
  `4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe`;
- schema identity
  `f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4`.

The target tuple is independently derived with the TypeScript and Python
provider codecs. Only schema version and all four reader/writer compatibility
versions move from one to two; limits, capabilities, protection, governance,
guarantees and observability remain byte-for-byte equivalent to the current
SQLite profile. The frozen outputs are:

- schema version `2`;
- provider descriptor
  `f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92`;
- raw canonical descriptor-body SHA-256
  `7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214`;
- complete canonical descriptor SHA-256
  `27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9`;
- schema identity
  `9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634`.

The descriptor domain is the 59-byte UTF-8 value
`graph-engineering/cycle-store-provider-descriptor/v1alpha1\0`. The canonical
body is 1,451 bytes, the domain-separated input is 1,510 bytes and the complete
descriptor is 1,535 canonical bytes. Both runtimes first reproduce the current
v1 descriptor and then derive the v2 descriptor; a repeated constant alone is
not parity evidence.

The frozen migration assets remain preview-only:

- `0002-v1-to-v2-operation-replay.sql` SHA-256
  `1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d`;
- `schema-v2.sql` SHA-256
  `5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5`;
- current preview-manifest SHA-256
  `f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf`.

Freezing these identities does not activate them. The preview manifest may be
replaced by an active manifest only after both runtimes, all migration paths,
installed package assets, cross-language reopen and crash/recovery gates pass.

#### 31.37.3 Two-phase unforgeable authority

A single session cannot truthfully commit to a post-DDL catalog fence before
`0002` creates that fence. B3 therefore uses two module-minted, one-shot
capabilities with separate write-ledger windows.

The outer publication authority is minted before the first permanent write. It
binds the exact B2 receipt, projection, stage transfer, baseline TEMP stage,
SQLite connection, transaction generation, migration-lock capability, source
identities, expected target identities and expected target catalog. It owns the
outer migration write ledger for `0002`, baseline publication, lineage and
metadata. It explicitly does not authorize cursor rebind.

After `0002`, the outer owner validates the observed target catalog and mints a
private post-DDL catalog fence. Only then may it derive the cursor publication
session. That session binds all eight exact objects:

1. pre-rebind receipt;
2. projection reference;
3. stage ownership transfer;
4. baseline TEMP stage;
5. SQLite connection;
6. outer publication authority;
7. post-DDL catalog fence; and
8. cursor publication session.

It also commits to the transaction generation, migration-lock ID, owner, epoch,
fencing token, source version, target version, active expiry, provider-clock
evidence, source descriptor/schema and target descriptor/schema. The lock epoch
must equal its fencing token. The active owner must match both authority phases.
The active expiry must be strictly after the provider-authoritative observation
clock. Lock freshness, transaction generation and catalog fence are reproved
before the first outer permanent write, immediately before cursor rebind,
before post-rebind verification and immediately before commit.

WeakMap in TypeScript and WeakKeyDictionary/private identity registries in
Python must back both capabilities. A dataclass, interface, frozen object or
structurally equal reconstruction is not authority. Clone, serialization round
trip, value substitution, new connection, rollback/rebegin, second begin,
second verification, abandoned-session reuse and disposed-stage reuse fail
before permanent mutation.

#### 31.37.4 Cursor write-ledger window and fixed rebind

The cursor write ledger opens at `cursor-publication-session-minted` and closes
after `rule-12-main-table-seal-accepted`. Outer migration writes are excluded
because the separate outer authority owns and accounts for them. Inside the
cursor window the only allowed permanent statement is:

```sql
UPDATE main.ge_cycle_cursors
SET descriptor_hash = ?, schema_identity_sha256 = ?
WHERE descriptor_hash = ? AND schema_identity_sha256 = ?
```

The parameters are target descriptor, target schema, source descriptor and
source schema. The normalized SQL SHA-256 is
`6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91`.
It is module-owned, prepared once, executed once and finalized once. Caller SQL,
triggers, a same-value replay, a second execution or any other permanent write
poisons the cursor owner.

Rule 11 accepts only when all four observations equal the exact cursor count in
the original B2 receipt:

- native statement affected-row count;
- `SELECT changes() AS affected_rows` result;
- `total_changes` delta for the cursor window; and
- cursor publication write-ledger delta.

The fixed `changes()` SQL has SHA-256
`a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112`.
A newly counted table, TEMP row count or post-rebind count cannot replace the
receipt count. A rule-11 failure contributes one aggregate count-mismatch unit,
poisons the owner and requires caller rollback.

#### 31.37.5 Constant-space, sorter-free rule-12 proof

An initial proposed direct main scan ordered by `(token_hash, tenant_id)` was
rejected by hostile review because v2 has only a `(tenant_id, token_hash)` main
primary key. Real EQP produced `USE TEMP B-TREE FOR ORDER BY`, which violates
the no-sorter and bounded-resource requirements even when application fetch
size is one.

The accepted design reuses the exact owner-fenced B2 TEMP seal table only as an
ordered key driver. Its `WITHOUT ROWID` primary key is
`(token_hash, tenant_id)`, so the fixed key query requires no sorter:

```sql
SELECT tenant_id, token_hash
FROM temp.ge_blr_cursor_seal
ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY
```

Its normalized SHA-256 is
`1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266`.
For each key, the verifier executes a fresh main primary-key point lookup:

```sql
SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash,
       stream_id, checkpoint_scope, request_scope_blob, page_size,
       next_position, snapshot_tail_sequence, snapshot_tail_record_hash,
       descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms,
       expires_at_ms, consumed_at_ms
FROM main.ge_cycle_cursors
WHERE tenant_id = ? AND token_hash = ?
LIMIT 1
```

Its normalized SHA-256 is
`bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342`.
The TEMP row never supplies post-rebind physical evidence. The fresh 18-column
main row supplies the identities, immutable fields and BLOB evidence. A
separate fixed main count, SHA-256
`60a469fbd75f9851c978b7a5b7ca1ac89ef446d3bd91f6cc1efa7e0611974383`,
detects extra rows. Missing lookups detect deletions. Equal count plus one
successful lookup for every original key closes equal-count replacement.

Actual EQP is part of fixture validation. The driver must scan the exact TEMP
primary-key order; every point lookup must report the main primary key with
`tenant_id=? AND token_hash=?`. `AUTOMATIC`, `MATERIALIZE`, `USE TEMP B-TREE`
and `CO-ROUTINE` are forbidden. No guessed SQLite autoindex name is required.

Each driver fetch, point lookup and seal append holds at most one raw main row,
one decoded carrier and one active point operation. Cancellation is polled per
row. The accepted `sqlite-cursor-seal/v1` row and seal domains remain unchanged.
The recomputed main count and immutable root must equal the exact B2 receipt;
every main row's two mutable identities must equal the frozen target tuple.

Rule 12 emits one aggregate `post-rebind-receipt-mismatch` unit. It does not
invent a cursor-row diagnostic for deletion, count drift, equal-count
replacement or a root mismatch that cannot be localized from the receipt.
Success alone performs the one-way
`publication-active -> cursor/clock-complete` transition. That capability is a
later publication-rule prerequisite, not permission to commit.

#### 31.37.6 Trusted literal, validator and parser hardening

The canonical contract consists of:

- `spec/conformance/sqlite-cursor-publication-rebind-v2.case.json`;
- its closed Draft 2020-12 schema;
- its executable validator;
- sixteen hostile `node:test` cases;
- `spec/sqlite-cursor-publication-rebind-v2.md`;
- a Python descriptor derivation report; and
- a TypeScript/Python parity test.

The fixture's trusted canonical SHA-256 is
`2585c7ebf5b36fad74e4a12cb17076bc2cc1d164cb1d9ecfbf719913feeb97a7`.
The validator contains that independent trusted anchor; it does not accept a
semantic mutation merely because an input updates its own digest. It also
hardcodes exact SQL literals, SQL hashes, identities, rules, authority objects,
session commitments, stage order, state transitions, boundary-local failure
precedence, hostile obligations, crash boundaries, cancellation labels,
statement lifecycle boundaries, cleanup faults and parity gates.

Hostile tests mutate and maliciously re-sign commitments, affected-count SQL,
rule semantics, obligation inventories and parity gates. All remain rejected.
The strict JSON parser constructs null-prototype objects, records every key as
an own data property and rejects duplicate keys, trailing content,
`__proto__` and `constructor` unknown-field attacks. Closed schema validation
and the trusted digest run before a contract can become evidence.

#### 31.37.7 Boundary-local failure and lifecycle order

A single flat failure list cannot express cancellation safely across an atomic
migration. The contract freezes four local orders:

1. before the first permanent write: receipt provenance, exact object graph,
   outer authority, lock, transaction and expected catalog outrank
   cancellation;
2. before cursor rebind: derived session, fresh lock, transaction and post-DDL
   fence outrank cancellation, after which cancellation may stop before the
   update;
3. after a statement starts: write-ledger, statement-shape and rules 11/12
   primary failures outrank later cancellation, and cleanup is last; and
4. after commit returns: complete-v2 reopen audit outranks cleanup, with no
   rollback claim.

The literal freezes sixteen cancellation labels covering outer authority,
`0002`, post-DDL fence, session mint, rebind prepare/execute, rule 11, key-driver
prepare/fetch, point-lookup prepare/execute/fetch, rule-12 finish and completion.
It freezes sixteen statement lifecycle boundaries and seven cleanup faults.
Every statement finalizes exactly once, every cursor closes exactly once, rule
12 polls cancellation per row, primary failure outranks cleanup failure and a
poisoned result exposes neither receipt nor root.

#### 31.37.8 Scheduled B2 evidence is a distinct prerequisite lane

Fast B2 characterization remains exactly 128 and 1,024 rows. It must not be
silently relabeled as 10K/100K evidence. A measured full 1,024-row two-runtime
run on 2026-07-29 required approximately three minutes and peaked near 112 MiB
RSS. Independent measured components were approximately 24 seconds for
TypeScript and 148 seconds for Python at 1,024 rows. The accepted cross-runtime
roots remain:

- 128 rows:
  `fc3699d41e2c4c9b0f45aa6c2afc1cfcbb7a89d1476420995427dd827bac9e32`;
- 1,024 rows:
  `9ad8d233c1f4d4717c126a9cf3aeb89675a3ddb15682e68b230c6fbec3e9e9a2`.

The existing Python evidence generator is not eligible for 100K: it constructs
a population-sized `rows` list and uses an in-memory database. Removing an
allow-list is not evidence. A separate scheduled lane must use a real disk
database, constant-live-row generation, one population/sample per subprocess
and parent-observed barriers.

On Linux, FILE-backed SQLite TEMP storage commonly appears as an unlinked
`/var/tmp/etilqs_* (deleted)` file descriptor and has no usable path in
`PRAGMA database_list`. The live worker must expose a before-cleanup barrier so
the parent can inspect `/proc/<pid>/fd`, use `fstat`, record TEMP backing bytes,
sample RSS and record database/WAL/SHM sizes. TEMP pages and page size remain
SQLite-level corroboration, not a substitute for file evidence.

The scheduled lane must freeze before execution:

- exact populations 10,000 and 100,000;
- warmup and measured sample counts;
- raw phase timing fields;
- nearest-rank or another exact percentile algorithm;
- p50, p95 and p99 derivation;
- RSS sampling interval and peak definition;
- TEMP-fd discovery and ambiguity handling;
- DB/WAL/SHM missing-file semantics;
- `seed-complete`, `campaign-start`, `campaign-complete` and `before-cleanup`
  worker barriers;
- root, count, 15-EQP and constant-live-resource assertions;
- per-runtime timeouts and cancellation cleanup;
- TS/Python root parity;
- retained raw artifacts and environment metadata; and
- conservative `implementationClaim:false`, `releaseGate:false` and
  `productionThroughputClaim:false` regardless of measured speed.

Initial one-sample budgets based on measured scaling are 15/90 minutes for
TypeScript 10K/100K and 60 minutes/6 hours for Python 10K/100K. Runtime and
population jobs should be a CI/manual matrix with artifact fan-in rather than a
serial developer gate. Repeated samples may require a dedicated scheduled
runner; wall-clock cost must be reported, never hidden.

#### 31.37.9 B2 subprocess crash/replay prerequisite

Cooperative cancellation tests do not prove process-crash behavior. A new B2
worker mode must reuse the existing ACK/barrier/SIGKILL process harness and
pause at source capture, TEMP stage creation, first/middle/last cursor row,
rule transitions, seal completion and pre-rebind completion.

After every forced kill, reopen must prove:

- exact old logical image and v1 identities;
- no permanent B2 or v2 partial state;
- disappearance of connection-local TEMP objects;
- clean catalog, foreign-key and integrity checks;
- no leaked migration authority; and
- a new transaction, source capture, receipt, TEMP stage and campaign converge
  on the same cursor count/root.

No cross-process test may pretend to reuse an opaque receipt object. Retry is
always a fresh authority graph. BUSY/LOCKED, process loss during TEMP file use,
cleanup-only failure and primary-plus-cleanup precedence remain explicit.

#### 31.37.10 Next implementation slices and merge ownership

The next maximum-parallel development queue is intentionally split into files
with disjoint owners:

1. `B2-SCHEDULED-EVIDENCE-CONTRACT`: shared schema, exact worker protocol,
   quantile algorithm, artifact schema and hostile validator;
2. `B2-SCHEDULED-TS`: disk-backed constant-space TypeScript worker with live
   barrier metrics;
3. `B2-SCHEDULED-PY`: disk-backed generator with no population-sized Python
   collection and the same barrier report;
4. `B2-CRASH-REPLAY`: new process worker modes and reopen proof;
5. `B3-AUTHORITY-BRIDGE-TS`: package-private outer authority, post-DDL fence,
   derived cursor session and write-ledger window, without permanent mutation;
6. `B3-AUTHORITY-BRIDGE-PY`: exact mirrored private capability chain;
7. `V2-ASSET-LOADER-TS`: vendor and validate v2 preview assets without changing
   the active v1 manifest;
8. `V2-ASSET-LOADER-PY`: identical wheel/sdist source assets and checksums,
   still refusing active v2;
9. `B3-REDBAR-TS` and `B3-REDBAR-PY`: fixture-consuming tests for all 33
   hostile obligations, 20 fault boundaries and lifecycle labels;
10. `B3-REBind-TS` and `B3-REBind-PY`: fixed update, exact affected counts,
    point-lookup seal and one-way completion behind package-private interfaces;
11. `V1-V2-ATOMIC-ORCHESTRATOR`: one owner integrates `0002`, permanent
    baseline, sequence, B3, lineage, metadata, publication rules and commit;
12. `V2-REOPEN-INTEROP`: fresh-v2, v1-to-v2, v0-to-v1-to-v2, existing-v2,
    future/foreign refusal and both cross-runtime directions;
13. `V2-FAULT-CRASH`: every pre-commit fault reopens v1, commit-returned reopens
    complete v2 and fresh retry completes once;
14. `V2-LEDGER-REPLAY`: format-2 request bytes, nine mutation families, global
    contiguous sequence, CAS, retry and bidirectional physical reconciliation;
15. `V2-BACKUP-ARTIFACT`: backup/restore/continue plus npm, wheel and sdist byte
    parity; and
16. `B3-FINAL-AUDIT`: full focused/adjacent/runtime suites, fixture/docs/package
    gates and independent HIGH/MEDIUM/LOW zero review before active-manifest
    switch.

`operation-baseline-stage.ts` and its large ownership test remain single-owner
files. The Python stage/campaign mirrors also remain single-owner. Spec lanes
must never bulk-format or clean the existing unrelated D4, D9, budget,
redaction, subgraph or progress-scanner worktree. `codex_logs/task-registry.json`
and the existing daily log already contain unrelated edits and are excluded
from this slice.

#### 31.37.11 Explicit nonclaims and delivery meaning

This contract tranche closes design ambiguity and establishes executable
rejection gates. It does not implement the authority bridge, permanent cursor
update, rules 11/12 in either runtime, `0002` runtime execution, permanent
baseline publication, v2 ledger, active v2 reopen, crash recovery, backup,
artifact parity, 10K/100K scheduled evidence or a stable release.

It also cannot guarantee a GitHub star count. The 5K/6K objective remains a
product and community target requiring documentation, demos, integrations,
external users, maintainers, releases and sustained outreach after technical
delivery. Forecasts and aspirations must remain distinct from executable
capability evidence.

No future checkpoint may claim the plan is complete merely because this B3
contract is frozen. Completion requires implementing and verifying every
preceding and appended acceptance leaf, recording exact evidence, resolving
all independent audit findings and preserving the existing append-only plan.

#### 31.37.12 Append-only post-review correction: authority adoption, cancellation and TEMP retirement

This subsection supersedes only the conflicting details inside appended
section 31.37; it does not delete or rewrite them. Final implementation must use
the stricter requirements here.

The outer atomic sequence contains 22 stages, not 19. After sequence zero, a
package-private stage-adoption intrinsic consumes exact module-minted receipts
for migration `0002`, baseline entries, baseline header and sequence zero. It
validates statement identity, affected counts and aggregate `total_changes`,
adopts the exact post-DDL catalog fence, retires the old v1 catalog/change fence
and mints a one-shot stage-adoption receipt. Only then may the cursor
publication session be derived.

The transaction promise is same `BEGIN EXCLUSIVE` lineage, not an unchanged
internal epoch number. TypeScript and Python may advance private mutation epochs
differently; cross-runtime epoch equality is false. Only the trusted bridge may
adopt an internal epoch. Caller-created receipts, unexplained DDL/DML and
partially accounted outer writes fail closed.

The exact object graph now additionally includes the opaque migration-lock
capability, exact provider-clock evidence and stage-adoption receipt. Both
authority phases commit to the capability and clock object identities, active
expiry and provider-now value. The strict validity condition is
`providerNowMs < activeExpiresAtMs`; equality is expired. Cloned lock
capability, substituted clock evidence, expiry before/equal now and expiry drift
after session mint are mandatory hostile cases.

Rule 12 does not use aggregate `SELECT count(*)`. It performs a cancellable,
one-row main-primary-key scan in `(tenant_id, token_hash)` order to count main
keys and detect extras, while the TEMP `(token_hash, tenant_id)` driver feeds
fresh main point lookups for the immutable seal. All three queries require real
sorter-free primary-key EQP. The main-key scan normalized SHA-256 is
`09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32`.

Rule 12 may hold at most two active cursors: one long-lived driver and one point
cursor. Every point cursor closes before the next driver fetch. Cleanup order
is point, driver, TEMP stage and outer cleanup. TypeScript promises logical
statement-ownership retirement, not a nonexistent native
`StatementSync.finalize()` method.

Cancellation labels are request-injection points, not unconditional immediate
throws. Once rebind begins, statement release, changes result, write ledger and
rule 11 primary proof occur before cancellation observation. Once a rule-12 row
begins, that row is decoded/validated and its point cursor closes before
cancellation. After the last row, accumulator finish and count/root/target-
identity comparisons occur before cancellation. Cleanup remains last.

After publication rules, the outer owner runs fresh-v2 catalog equality and all
physical/semantic postconditions, then retires/drops the exact TEMP stage, then
reproves the final migration-lock/transaction fence, then commits. A cleanup-
only TEMP retirement failure prevents commit. If an earlier primary exists,
retirement failure never replaces it.

The final frozen fixture has 22 ordered stages, 38 hostile obligations, 20
fault boundaries, 20 cancellation labels, 16 statement lifecycle boundaries,
seven cleanup faults and trusted canonical SHA-256
`b19d754dd68f78f8197532cee23488941e7ab8e054886de15b3c6f2349783c67`.
All implementation and release claims remain false until the runtime bridge,
rebind, atomic orchestrator, crash/reopen, scale and artifact gates pass.

#### 31.37.13 Append-only final contract correction: fresh clock chain and exact retirement authority

This subsection supersedes only the counts and authority details in appended
sections 31.37 through 31.37.12. It preserves every original-plan byte and
records the stricter candidate produced by the final independent reviews.

The atomic sequence contains 23 ordered stages. The new stage is
`pre-retirement-stage-fence-adopted`, ordered after publication rules,
fresh-v2 catalog equivalence and physical/semantic postconditions, and before
`cursor-temp-stage-retired`. The final frozen candidate contains 63 hostile
obligations and trusted canonical SHA-256
`047dae82864b72fda1e2877be4e2a149ca3c7adefbd3394bfbfffbe7b66436ef`.
The 20 fault boundaries, 20 cancellation labels, 16 statement lifecycle
boundaries and seven cleanup faults remain unchanged. All implementation,
release, production-throughput and active-manifest claims remain false.

##### 31.37.13.1 Provider-clock capability and four fresh receipts

Runtime implementation must mint one opaque, package-private, non-cloneable
provider-clock capability bound to the exact provider clock source, SQLite
connection, live `BEGIN EXCLUSIVE` lineage, migration-lock capability and
outer publication authority. Callers cannot supply `providerNowMs`.

The capability is a closed four-boundary state machine and must mint four
different opaque object identities in exact order:

1. `outerClockEvidence` before the first permanent mutation;
2. `preRebindClockEvidence` before cursor rebind;
3. `preVerificationClockEvidence` before publication verification;
4. `preCommitClockEvidence` after TEMP retirement and before commit.

At every boundary it must reread the live lock row, read the bound provider
clock again, validate a safe integer, prove the exact lock ID, owner, epoch,
fencing token, source/target versions and unchanged committed expiry, prove
`epoch == fencingToken`, prove provider time is nondecreasing and enforce the
strict inequality `freshProviderNowMs < committedActiveExpiresAtMs`. Numeric
timestamp equality does not prove evidence freshness. Every receipt binds its
boundary ordinal, capability identity, connection, transaction lineage, lock
capability, live lock tuple, provider time, active expiry and the preceding
receipt identity. Each receipt is consumed exactly once by its intended owner.

Skipped, repeated, reordered or fifth observations fail. A previous-boundary
receipt cannot be replayed, even when the numeric timestamp is unchanged. A
clock that advances past an unchanged expiry after session mint, after rule 12
or after TEMP retirement prevents verification or commit. Clock/lock authority
failure at a boundary outranks simultaneous cancellation.

##### 31.37.13.2 Post-cursor outer-write receipts and second adoption

After `cursor/clock-complete`, migration lineage publication and
schema/descriptor metadata publication remain exactly two outer-authority
permanent writes. Each write mints a module-owned, opaque, one-shot receipt
binding normalized SQL identity, parameters/results, affected count,
`total_changes` before/after/delta, outer-ledger sequence/delta, exact
connection, transaction lineage, outer authority and post-DDL catalog fence.

The package-private pre-retirement adoption intrinsic runs only after the
following exact objects exist and are successful:

- cursor/clock completion capability;
- original stage-adoption receipt;
- lineage publication receipt;
- schema/descriptor metadata publication receipt;
- publication-rules receipt;
- fresh-v2 catalog-equivalence receipt;
- physical/semantic-postconditions receipt; and
- pre-verification clock receipt.

It proves the two writes occurred exactly once and in order; all SQL identities,
affected counts, `total_changes` and outer-ledger deltas agree; no unexplained
permanent write occurred after initial adoption; all three audits produced zero
permanent-write delta; the exact target catalog remains live; the same
`BEGIN EXCLUSIVE` lineage remains active; and no cursor, statement or cleanup
owner is unaccounted. Only then may it adopt the runtime-private current epoch
and mint one opaque `preRetirementStageFenceReceipt`. It never mints a second
initial adoption receipt. After the pre-retirement receipt is minted, every
permanent write is forbidden.

##### 31.37.13.3 Exact TEMP retirement

The retirement intrinsic consumes the exact pre-retirement receipt once. It
requires zero active main-key-count, key-driver and point cursors and no live
statement owner. The receipt-bound TEMP inventory identifies every object by
type, name, table name, root page or runtime generation, normalized SQL digest
and stage ownership generation. Name-only matching is insufficient.

Before each reverse-ownership-order drop, runtime code must recheck exact
identity. It must drop every owned object, preserve unrelated caller TEMP
objects, prove all exact objects absent, prove reserved owned-prefix residue
count zero and prove cursor/outer permanent ledgers plus `total_changes` did
not move. Partial retirement, identity substitution, same-name replacement,
extra prefix residue or cleanup failure cannot mint success and cannot permit
commit. Successful retirement mints one opaque `stageRetirementReceipt`.

##### 31.37.13.4 Final commit fence

The final fence consumes the exact retirement receipt, fresh pre-commit clock
receipt, publication-rules receipt, fresh-v2 catalog receipt and physical/
semantic postconditions receipt. It freshly proves the live transaction
lineage, exact lock tuple and strict expiry, target catalog, outer and cursor
write ledgers, `total_changes`, zero owned TEMP residue, absence of permanent
writes after pre-retirement adoption and absence of unexplained internal-epoch
adoption. Success mints a one-shot `finalCommitFenceReceipt`; only the atomic
migration commit intrinsic may consume it, exactly once. A boolean result,
structurally equal object, clone or serialized reconstruction grants no commit
authority.

##### 31.37.13.5 Main-key count cancellation and phase cleanup

The sorter-free main-primary-key scan owns at most one cursor and one live key
row. A started row completes fetch-result validation, arity/storage validation,
strict key ordering and checked safe-count increment before cancellation is
observed. Cancellation before a fetch closes and clears the cursor before it is
exposed. Terminal fetch proves the terminal iterator result, closes and clears
ownership, freezes the count and only then observes cancellation. The count
cursor must be closed before key-driver preparation.

Cleanup is phase-specific, never a fictitious three-cursor stack:

- count phase: main-key-count cursor, TEMP stage, outer cleanup;
- seal phase: point cursor, key-driver cursor, TEMP stage, outer cleanup.

Earlier row/fetch/decode/order/count primary failure outranks count-cursor close
failure; close failure outranks cancellation; cancellation outranks later TEMP
or outer cleanup failure. Every acquired cursor closes and clears ownership
exactly once. The global live-cursor maximum remains two during the seal phase.

##### 31.37.13.6 Required implementation leaves

- `B3-CLOCK-01`: four boundary evidence object identities are distinct and ordered.
- `B3-CLOCK-02`: every evidence receipt is consumed exactly once and stale replay fails.
- `B3-CLOCK-03`: every boundary rereads the live lock and provider clock.
- `B3-CLOCK-04`: regression, equality/past expiry and fifth observation fail closed.
- `B3-CLOCK-05`: post-session clock advance beyond expiry blocks verify/commit.
- `B3-CLOCK-06`: clock/lock authority failure precedes simultaneous cancellation.
- `B3-ADOPT-01`: lineage and metadata writes emit exact outer-authority receipts.
- `B3-ADOPT-02`: pre-retirement adoption closes SQL/count/ledger/catalog/audit evidence.
- `B3-ADOPT-03`: its receipt is opaque, single-use and forbids later permanent writes.
- `B3-RETIRE-01`: TEMP retirement uses full identity rather than names alone.
- `B3-RETIRE-02`: zero owned residue is proved and unrelated TEMP objects survive.
- `B3-RETIRE-03`: partial/cleanup failure cannot mint a retirement receipt or commit.
- `B3-RETIRE-04`: final fence consumes the exact retirement receipt once.
- `B3-FENCE-01`: final fence freshly reproves clock, lock, transaction, catalog and ledgers.
- `B3-FENCE-02`: a one-shot final receipt is the only commit authority.
- `B3-FENCE-03`: any permanent write after retirement prevents commit.
- `B3-COUNT-01`: count scan is one-row, sorter-free, ordered and overflow checked.
- `B3-COUNT-02`: count cursor closes before driver preparation.
- `B3-COUNT-03`: count and seal cleanup orders remain separate.
- `B3-COUNT-04`: started-row primary proof precedes cancellation observation.
- `B3-COUNT-05`: cursor-close failure precedence is exact and hostile-tested.
- `B3-COUNT-06`: cancellation/failure paths close and clear ownership exactly once.
- `B3-COUNT-07`: resource evidence proves no count+driver+point three-cursor overlap.

No B3 implementation leaf may be checked until both TypeScript and Python
runtime behavior, hostile tests, crash/reopen matrices and artifact parity
demonstrate these requirements. A contract-only commit is allowed only after a
fresh independent review reports HIGH 0 / MEDIUM 0 / LOW 0.

#### 31.37.14 Append-only authority-chain correction after root-page reuse test

This subsection supersedes only the candidate digest/count and the ambiguous
receipt/retirement details in appended section 31.37.13. A real SQLite test
proved that dropping and recreating the same TEMP table with identical DDL may
reuse the same `rootpage`; root page is therefore diagnostic only and can never
be sufficient object identity.

The stable contract candidate retains 23 stages and now freezes 80 hostile
obligations with trusted canonical SHA-256
`9ed27de3dadb8989b51da9864b2109f0b760043bea52b3c73234013150e74ef3`.

Every owned TEMP object must carry an unforgeable module-minted runtime object
generation nonce plus the guarded connection's TEMP-catalog mutation epoch.
Every TEMP DDL advances that epoch. Pre-retirement adoption binds the starting
epoch; retirement owns the only authorized mutation chain, and each exact
owned drop consumes the prior epoch receipt and mints the next. Unexplained
DDL, a same-name/same-DDL replacement, root-page reuse, missing links or an
unaccounted extra object break the chain and prevent a retirement receipt.

Clock evidence consumption is now explicit and symmetric:

- outer publication authority consumes `outerClockEvidence` exactly once;
- publication session consumes `preRebindClockEvidence` exactly once;
- cursor-clock capability consumes `preVerificationClockEvidence` exactly once;
- final fence consumes `preCommitClockEvidence` exactly once.

The cursor-clock capability is itself opaque, module-minted, single-use and
clone-rejected, and binds the exact clock/lock/connection/transaction/session
tuple plus rules 11/12 success receipts. Post-cursor adoption verifies its
consumed-evidence tombstone without consuming the pre-verification receipt a
second time.

Lineage, metadata and all three audit receipts are consumed exactly once by
pre-retirement adoption, which mints five consumed-receipt tombstones. The
opaque pre-retirement receipt commits original receipt identities, tombstones,
connection/transaction/catalog authority, ledger/changes watermarks, TEMP
inventory and mutation epoch. The opaque retirement receipt transitively
commits that object plus the authorized TEMP-drop epoch chain and zero residue.
The opaque final commit-fence receipt consumes only the retirement receipt and
fresh pre-commit clock receipt; it relies on the retirement receipt's
transitive consumed-audit tombstones rather than re-consuming audit receipts.
All three receipts are module-minted, single-use and clone-rejected with exact
commitment inventories.

Main-key count cleanup is branch-specific. Success closes and clears the count
cursor before preparing the driver. Failure/cancellation closes count then
TEMP/outer cleanup; seal failure/cancellation closes point then driver then
TEMP/outer cleanup. Terminal cancellation is observed only after terminal
proof, cursor closure/ownership clear and frozen count. Fetch, decode, order,
count or terminal primary failure outranks close failure; close failure outranks
cancellation; cancellation outranks later TEMP/outer cleanup failure.

The additional implementation leaves are:

- `B3-TEMP-ID-01`: same-name/same-DDL/rootpage-reuse replacement is rejected.
- `B3-TEMP-ID-02`: every TEMP DDL advances a guarded mutation epoch.
- `B3-TEMP-ID-03`: multi-object retirement has a complete authorized epoch chain.
- `B3-RECEIPT-01`: all four clock evidence receipts have one explicit consumer.
- `B3-RECEIPT-02`: cursor-clock authority commits the consumed verification receipt.
- `B3-RECEIPT-03`: outer-write/audit receipt consumption mints exact tombstones.
- `B3-RECEIPT-04`: three transitive authority receipts reject clone and drift.
- `B3-RECEIPT-05`: final fence never re-consumes single-use audit receipts.

This still freezes design only. Runtime implementation, hostile execution,
crash/reopen, scale, cross-runtime artifact parity and active-manifest switch
remain pending and may not be claimed by this contract milestone.

#### 31.37.15 Append-only contract-freeze acceptance checkpoint

The exact candidate in section 31.37.14 passed three independent reviews, each
reporting HIGH 0 / MEDIUM 0 / LOW 0 against digest
`9ed27de3dadb8989b51da9864b2109f0b760043bea52b3c73234013150e74ef3`.
Focused B3 tests passed 19/19, the combined SQLite ledger contract passed
46/46, TypeScript/Python descriptor parity passed 1/1, all 79 JSON fixtures and
38 case manifests validated, 288 documentation links passed, all eight
workspace packages passed lint/typecheck, and the Python derivation report
passed Ruff lint/format.

This checks only the `B3-CONTRACT-FREEZE` leaf and authorizes its isolated
milestone commit. Every runtime, migration, crash/reopen, scheduled scale,
artifact parity, active-manifest, release, adoption and star-growth leaf remains
open. The immediate next implementation slice is `B3-AUTHORITY-BRIDGE`: add
red tests and package-private TypeScript/Python objects for the provider-clock
capability, initial stage adoption and post-cursor/pre-retirement authority
chain without executing permanent v2 publication or switching the manifest.

#### 31.37.16 Append-only initial-adoption atomic-consumption correction and bridge tranche

The first authority-bridge implementation review found one contract ambiguity
that section 31.37.15 did not close: the initial bridge listed four required
outer-write receipts but did not literally freeze exact-once consumption,
all-or-nothing bundle validation or consumed tombstones. This subsection
supersedes only that omission and the candidate digest/count.

The contract candidate now has 23 stages, 83 hostile obligations and trusted
canonical SHA-256
`b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`.
Before initial adoption, the package-private bridge validates the complete
ordered bundle of migration `0002`, baseline entries, baseline header and
sequence-zero receipts. Missing, reordered, cloned, substituted, replayed or
inconsistent bundles consume zero receipts and mint no authority. The same
exact valid bundle remains retryable after validation-only failure. Success
atomically consumes all four exactly once and mints four exact consumed
tombstones plus the one-shot stage-adoption receipt.

The first runtime tranche is intentionally narrower than full B3. It may add:

- an opaque connection transaction-lineage token that is stable for one real
  `BEGIN EXCLUSIVE` generation, survives DDL mutation-epoch advances, and is
  replaced/cleared by rollback, commit, close or transaction replacement;
- an opaque migration-lock capability bound to the exact live lock tuple,
  connection and transaction lineage;
- an opaque provider-clock source minted by package-owned provider code;
- an opaque four-boundary provider-clock capability;
- distinct evidence receipts that bind exact previous-receipt identity,
  boundary, consumer, live lock, fresh provider time, current mutation epoch
  and stable transaction lineage; and
- exact-once consumed-evidence tombstones.

This tranche must not prepare or execute the cursor UPDATE, run rule 11/12,
execute migration `0002`, publish baseline/metadata rows, retire TEMP objects,
commit, activate schema v2 or change any capability claim. Its TypeScript red
and hostile tests must prove:

1. exactly four ordered observations and a rejected fifth;
2. exact previous receipt identity for every observation;
3. one fixed consumer and one consumption per receipt;
4. clone, cross-run and capability substitution rejection;
5. safe/nonnegative/nondecreasing fresh provider time;
6. strict `providerNowMs < activeExpiresAtMs` including equality rejection;
7. live lock reread before and after every provider-clock call;
8. zero lock/connection/`total_changes` mutation by the clock source;
9. DDL mutation epoch may advance while the same BEGIN lineage remains valid;
10. rollback/rebegin invalidates every old capability despite an equal lock row;
11. public package exports remain unchanged; and
12. permanent rebind prepare/execute and commit counts remain zero.

The matching Python tranche must use an opaque object-identity transaction
generation token rather than its mutable statement epoch, consume the real
private B2 transfer rather than the publicly constructible clean-outcome
dataclass, and stop before rebind. Cross-runtime parity compares normalized
outcomes and counters only; opaque token bytes or language-specific epoch
values must never be serialized or compared.

#### 31.37.17 Provider-clock authority hostile-state-machine closure

Independent executable review of the first provider-clock candidate found
three authority failures that ordinary happy-path tests did not expose. This
subsection makes their remediation and evidence mandatory before a milestone
commit. It does not expand the tranche into cursor publication.

First, an observation is a one-way state machine, not a retryable function.
Before the provider callback runs, the capability enters an internal
`observing` state. Recursive observation of the same capability is forbidden,
poisons the authority and cannot mint either the inner or outer evidence
receipt, even when the hostile callback catches the inner structured error.
Any provider exception, invalid provider time, post-callback lineage change,
mutation-epoch change, `total_changes` change, live-lock drift, clock
regression or expiry failure after observation begins also poisons the
capability. A later call at the same boundary must fail without invoking the
provider again. The surrounding `BEGIN EXCLUSIVE` transaction remains subject
to mandatory rollback by the eventual B3 owner.

Second, transaction lineage follows real transaction generations rather than
SQL formatting. The TypeScript owner must:

- retain the exact lineage across the frozen multi-statement `0002` DDL;
- retain it across ordinary multi-statement DDL;
- retain it across `CREATE TRIGGER ... BEGIN ... END` bodies;
- replace it when a script actually ends and begins a transaction;
- mint and expose a non-null lineage inside `immediate()` actions;
- clear it after successful commit, rollback and close; and
- reconcile non-null lineage with SQLite state when a multi-statement script
  begins a transaction and then throws.

The lexical transaction-control detector must ignore comments, quoted strings,
quoted identifiers and Trigger body `BEGIN`/`END`. Conservative false positives
are allowed only where they cannot invalidate the frozen `0002` path or normal
DDL. They must never permit a real `COMMIT`, `ROLLBACK`, `END` or new `BEGIN`
to carry the preceding lineage.

Third, hostile migration-lock shapes must always fail through the structured
provider error surface. Null, undefined, missing data properties, accessor
properties and throwing Proxy traps may not leak raw TypeError or attacker
exceptions. Required lock fields are captured from exact own data-property
descriptors before validation; no attacker getter may be invoked. The captured
lock must still satisfy source/target versions, equal positive epoch/fence,
bounded expiry, identifiers and exact live-row equality.

The cross-runtime evidence report is expanded to include these explicit zero
counters for every scenario:

- `cursorRebindPrepareCount`;
- `cursorRebindExecuteCount`; and
- `commitCount`.

A static gate also rejects the fixed cursor UPDATE or transaction-finalization
path from either package-private clock module. The normalized parity matrix
must remain exact for control, rollback/rebegin, skipped boundary, regression,
expiry equality, invalid clock and lock drift. Public-export flags must remain
false in both runtimes.

Required executable acceptance before committing this tranche:

1. TypeScript clock, connection and stage-focused tests pass, including exact
   frozen `0002`, Trigger DDL, immediate lineage, reentrancy poison, side-effect
   poison-and-retry rejection and hostile lock descriptors.
2. Python clock, source and stage-ownership tests pass with the same
   reentrancy and poison semantics.
3. TypeScript build/typecheck and Python strict mypy, Ruff lint and Ruff format
   gates pass without ignores added for production code.
4. Cross-runtime parity passes every normalized field and all three explicit
   no-publication counters.
5. The B3 contract remains 23 stages, 83 hostile obligations, false
   implementation/manifest claims and digest
   `b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`.
6. Malicious re-sign tests directly reject weakening
   `failedBundleMayRetryWithSameExactBundle` and
   `mintsConsumedReceiptTombstones`.
7. Full SQLite tests are rerun without competing long-lived test processes and
   with sufficient deterministic per-test timeout; timeout-only failures under
   artificial concurrent saturation are not reported as correctness failures.
8. Three independent final reviews examine the exact working-tree digest and
   report HIGH 0 / MEDIUM 0 / LOW 0 before the scoped commit.

Even after this subsection passes, the following remain open and must be built
in later leaves: exact private B2 transfer consumption, outer publication
authority, migration `0002` receipt, four permanent-write receipts, atomic
initial stage adoption, publication session, fixed rebind execution, rule 11,
rule 12, cursor-clock authority, post-cursor adoption, TEMP retirement,
pre-commit fence, commit-returned state, crash/reopen matrix, scale proof,
artifact parity and active-manifest activation. No success statement for this
clock tranche may imply those downstream capabilities exist.

#### 31.37.18 Provider-clock tranche acceptance checkpoint

The implementation defined in sections 31.37.16 and 31.37.17 has passed its
scoped acceptance gates. TypeScript and Python now share the same private
four-boundary provider-clock authority, stable real-transaction lineage,
chained opaque evidence, exact consumers, consumed tombstones, one-way poison
semantics and non-publication boundary.

Final executable evidence:

- frozen B3 contract: 19/19 tests, 23 stages, 83 hostile obligations, 20 fault
  boundaries, false implementation/active-manifest claims and canonical digest
  `b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`;
- TypeScript focused clock/connection/stage tests: 62/62;
- Python focused clock/source/stage-ownership tests: 103/103;
- latest Python clock-only tests after final poison changes: 12/12;
- cross-runtime normalized parity and no-publication gates: 2/2;
- SQLite package full serial regression: 23/23 files and 845/845 tests;
- Python full regression: 2,248/2,248 tests, plus the latest separately
  collected clock-only additions;
- workspace lint and typecheck: all eight packages;
- fixture validation: 79 JSON fixtures and 38 case manifests;
- documentation links: 288/288;
- Python Ruff lint, both 88- and 100-column Ruff format checks, and strict
  mypy: passed; and
- master-plan integrity: the complete pre-existing HEAD byte prefix is
  unchanged and all current plan text is appended at true EOF.

The runtime measurement hooks were self-tested rather than trusted as literal
zeros. In both runtimes an isolated no-op probe records cursor-rebind
prepare/execute/commit as `1/1/1`; all seven real authority cases record
`0/0/0`. Public-export probes are false for both packages.

Independent final review reached HIGH 0 / MEDIUM 0 / LOW 0 for the strict
state-machine and evidence lanes. The release-quality lane's two presentation
LOWs were corrected before commit: ternary indentation was normalized and the
append-only log received the completed serial-regression evidence.

This checkpoint authorizes only a scoped provider-clock authority milestone
commit. It does not close the overall master plan or full B3. The next required
implementation leaf is exact private B2 transfer adoption plus outer
publication authority and the four initial write receipts, stopping again
before fixed cursor rebind until its own hostile and parity gates pass.

#### 31.37.19 Initial-publication contract correction before runtime implementation

Parallel read-only design of the next B3 leaf found that the high-level stage
order is frozen but the initial publication lane is not yet deterministic
enough for two runtimes to implement independently. Production implementation
must pause until a narrow append-compatible contract correction freezes the
following literal semantics and receives a new canonical digest.

The corrected authority contract must replace the ambiguous
`outerPublicationAuthority.singleUse` label. The outer clock evidence is
consumed exactly once while minting the authority; the authority itself is
minted once, non-transferable and reusable only as an identity commitment by
the four initial writes, post-DDL fence, initial adoption, publication session
and later final fences in the same exact graph. It is retired only by rollback,
poison/disposal or the successful outer atomic commit. No write or adoption
step consumes the authority object.

Add a dedicated `initialOuterWriteReceiptContract` for the exact ordered
receipts:

1. migration `0002` physical-catalog rebuild;
2. baseline-entry publication;
3. baseline-header publication; and
4. operation-sequence-zero publication.

Every receipt is opaque, module-minted, exact-identity, clone/cross-run/
substitution/replay rejected and bound to its exact predecessor. Common
commitments include write kind, fixed normalized SQL or repository-asset
identity and SHA-256, exact parameter/result identity, exact connection,
unchanged BEGIN lineage, outer authority identity, prepare/execute count,
affected rows, `total_changes` before/after/delta and outer-ledger
before/after/sequence/delta.

The migration receipt additionally commits the exact immutable `0002` bytes,
migration/preview-manifest identities, one execution, copied schema-row count,
copied legacy-operation count, application ID, user version, pre/post physical
catalog digests and the pre-publication metadata state. The entries receipt
commits baseline ID, entry count, one affected row per ordinal, continuous
ordinal/hash chain, first/final entry hash and projection identity. The header
receipt commits one affected row plus baseline ID, counts, projection hash,
first/final hashes, runtime identity and policy blob identity. The sequence
receipt commits one affected row, the same baseline ID, commit sequence zero,
captured/updated timestamps and exact predecessor.

Add an independent `postDdlCatalogFence` contract. The fence is opaque,
module-minted once after the exact `0002` receipt and before baseline DML,
clone/substitution/replay rejected and reusable only as an exact identity
proof. It binds the connection, unchanged BEGIN lineage, outer authority,
`0002` receipt, current private mutation epoch, `total_changes` and ledger
watermarks, physical `sqlite_schema` digest, application/user versions and
the complete expected v2 table/index/column/constraint inventory. Its proof
scope is the physical post-`0002` catalog before final metadata publication;
it must not falsely claim final fresh-v2 semantic equivalence.

Add an independent `stageAdoptionReceipt` contract. Successful initial
adoption validates the complete four-receipt bundle before consuming anything,
then performs one non-interruptible state mutation that consumes all four,
mints four ordered exact tombstones, updates the stage's current private epoch,
allowed `total_changes`, outer-ledger watermark and v2 main-catalog identity,
retires only the old B2 v1 catalog/change fence, and mints one opaque adoption
receipt. The receipt binds the exact B2 receipt/projection/transfer/stage,
connection/lineage, outer authority, post-DDL fence, four original receipts,
four tombstones, target catalog digest and all adopted watermarks. The
post-DDL fence remains live for publication-session and later receipt checks.

Validation-only bundle failures consume zero receipts, do not mutate stage or
ledger state and permit the original valid receipt objects to be presented in
a corrected complete bundle. Missing, reordered, duplicate, cloned,
substituted, cross-run or wrong-predecessor presentations are validation-only.
Authority, transaction-lineage, live-lock, catalog, unexplained-write,
affected-count, `total_changes` or ledger corruption poisons the owner and
requires rollback. After atomic consumption begins there is no injectable
failure or cancellation boundary.

Add leaf-local failure precedence for outer-authority mint, before `0002`,
after `0002` before fence, before entries, before header, before sequence-zero,
initial-adoption validation and initial-adoption atomic consumption. Before a
statement starts the order is state, B2 provenance, exact graph, authority/
receipt identity, connection/lineage, live lock/clock, catalog/fence,
statement/parameter/ledger commitments, cancellation, prepare and execute.
After execution begins, SQLite/result primary failure precedes affected-count,
`total_changes`, ledger, cancellation and cleanup.

The correction must add malicious re-sign tests for every new Boolean,
commitment list, predecessor relation, ledger rule and proof-scope field. It
must also add hostile obligations for cloned/substituted/cross-run authority,
`0002` byte/hash drift and partial/second execution, early/cloned/substituted
post-DDL fence, catalog drift after fence, missing/reordered/duplicate/cloned
initial receipts, wrong authority/lineage/predecessor, header/sequence replay,
stage-adoption clone/replay and cancellation immediately before atomic
consumption.

Only after schema, validator, malicious tests, documentation, fixture digest,
cross-runtime parity matrix and three independent reviews agree at severity
zero may TypeScript/Python runtime code begin. The runtime parity report will
compare normalized outcomes, failure boundary, state/poison flag, clock reads,
authority/fence/receipt/tombstone/adoption counts, four per-write prepare/
execute/affected/`total_changes` counters, outer-ledger sequence, bundle
retryability, same-lineage/catalog-fence relations and real zero cursor-rebind/
commit counts. Opaque addresses and private epoch values remain incomparable.

#### 31.37.20 B3 initial-publication contract correction accepted for runtime implementation

The contract-first correction required by section 31.37.19 is complete. The
previous provider-clock checkpoint digest
`b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0`
is superseded by the reviewed canonical fixture digest
`c2ffa4100e73f823de0cfba8ae4b379ef00736b104d41988753b588b5d082eb8`.
This is a normative contract revision, not runtime-delivery evidence. The
fixture still declares implementation, release, active-manifest, protocol-
completion and production-throughput claims false. No cursor rebind, commit,
manifest switch or accepted v2 database is authorized by this checkpoint.

The corrected authority graph freezes exactly 34 opaque objects. Exact object
identity is semantic: reconstruction, serialization round-trip, cloning,
structural equality, substitution and cross-run reuse cannot satisfy an edge.
The graph distinguishes the B2 receipt/projection/transfer/stage quartet, live
connection, migration-lock and provider-clock capabilities, four boundary
clock receipts, outer publication authority and its consumed-clock tombstone,
post-DDL catalog fence, post-DDL reader lease, four initial-write receipts and
four consumed tombstones, stage-adoption receipt, publication session and
cursor clock, later publication/audit receipts, pre-retirement fence,
retirement receipt and final commit fence.

The outer publication authority is minted once, non-transferable and reusable
only as an identity commitment inside its exact graph. It is not consumed by
the initial writes, catalog fence or adoption. It is retired only on commit-
returned, rollback, poison or disposal. Minting is a validation-first
intrinsic followed by one non-interruptible tail: consume the outer clock
evidence once, mint its exact tombstone, publish the prepared B2 transfer and
activate the authority. A presentation failure or cancellation before the
tail consumes nothing and may retry with the same evidence. Fault injection
is forbidden after the tail begins; an invariant failure there poisons the
graph and requires rollback plus a fresh graph.

The initial permanent-write chain is literal and closed:

1. execute the exact immutable migration `0002` repository asset once;
2. mint and validate the post-DDL physical-catalog fence;
3. acquire the exact publication reader lease and publish ordered baseline
   entries from the B2 TEMP stage;
4. publish one final baseline header with stable runtime identity;
5. publish operation-sequence zero with provider-authoritative time; and
6. validate, consume and adopt the complete four-receipt bundle atomically.

Each initial receipt binds its exact write kind, normalized SQL or immutable
repository-asset bytes and SHA-256, canonical parameter and result digests,
exact predecessor objects, connection, unchanged `BEGIN EXCLUSIVE` lineage,
outer authority, prepare/execute counts, affected rows, `total_changes`
before/after/delta and all outer-ledger before/after values. The ledger has
three independently checked dimensions: logical-write sequence, fixed-
statement execution count and affected-row watermark. Migration `0002`
advances those dimensions by `1`, `20` and
`1 + projection.legacyOperationCount`; baseline entries advance them by `1`,
`projection.entryCount` and `projection.entryCount`; the header and sequence-
zero writes each advance them by `1`, `1` and `1`.

Parameter and result identities use one cross-runtime digest codec rather
than adapter serialization. Parameter hashes cover a domain-separated,
canonical JSON exact-order array of typed scalars. Unicode is not normalized,
integers use canonical decimal with negative zero forbidden, BLOBs use
unpadded RFC 4648 section 5 base64url, and null carries an explicit tag.
Result hashes use a different domain and canonical JSON with affected rows as
a non-negative canonical-decimal string; `lastInsertRowid` is excluded. Both
runtimes must implement this codec from the same fixture and prove known-answer
vectors before any receipt is trusted.

The post-DDL fence is an independent, module-minted proof created once after
the exact `0002` receipt and before baseline DML. It binds connection,
transaction lineage, authority, migration receipt, current mutation epoch,
`total_changes`, all three outer-ledger watermarks, physical `sqlite_schema`
digest, application/user versions and the complete expected v2 object
inventory. Its proof scope is deliberately narrow: the physical post-`0002`
catalog before baseline publication. It does not claim final fresh-v2 semantic
equivalence and it remains live after the initial stage adoption.

The post-DDL publication reader lease closes the source-read race. Only this
package-private lease may run the exact ordered TEMP-stage read that feeds the
baseline-entry writer. It binds the exact stage, projection, connection,
lineage, authority, post-DDL fence, normalized SQL and canonical projection.
It must close before adoption. Clone, substitution, replay, wrong-run use,
SQL/order/projection drift, cursor leakage and cancellation-close failure are
contract failures with explicit precedence and cleanup behavior.

Initial stage adoption validates the complete ordered receipt bundle before
consuming any member. Missing, reordered, duplicate, cloned, substituted,
cross-run or wrong-predecessor presentations consume nothing and permit the
same original receipt objects to be retried inside a corrected complete
bundle. Once the non-interruptible adoption tail starts, it consumes all four
receipts, mints four exact tombstones, updates the private stage watermarks,
retires only the old B2 v1 catalog/change fence, preserves the post-DDL fence
and mints one exact stage-adoption receipt. No cancellation or fault injection
is legal inside that tail. Authority, transaction-lineage, live-lock,
catalog, unexplained-write, affected-count, `total_changes` or ledger
corruption poisons the owner and requires rollback rather than retry.

The executable failure model now freezes exactly 12 boundary-precedence
objects, 25 cancellation labels, 19 statement/ownership boundaries and eight
cleanup faults. It covers outer-authority validation and atomic mint, before
and after each initial permanent write, reader acquisition/read/close,
adoption validation and atomic consumption, before cursor rebind, started-
statement failure and post-commit interpretation. After statement start, the
literal keeps SQLite error or result-shape failure primary, followed by
affected-row count, `total_changes`, permanent-write ledger, cancellation and
cleanup. Implementations must preserve this local ordering rather than route
all failures through a generic exception path.

The hostile registry now contains exactly 141 unique obligations. New coverage
includes authority clone/substitution/cross-run/use-after-retirement and atomic-
mint attacks; exact `0002` bytes/hash/partial/second-execution and three-ledger-
dimension disagreements; early, cloned, substituted, replayed or drifted
catalog fences; reader-lease identity, query, order, projection, leak and
close failures; missing, reordered, duplicate, cloned, substituted, cross-run
and wrong-predecessor receipts; baseline partial execution; ambient/caller
runtime identity and caller timestamp substitution; precise before/after-
statement cancellation; and stage-adoption replay, cancellation and forbidden
in-tail injection. Both runtimes must execute the registry; checking only the
count is insufficient.

Initial-publication parity freezes exactly 28 ordered normalized fields:
case/outcome/boundary/state/poison status; real provider-clock read, evidence-
consume and authority-mint counters; four per-write prepare, execute, affected-
row and `total_changes` vectors; all three outer-ledger dimensions; catalog-
fence and reader-lease mint/close counts; receipt mint/consume/tombstone and
adoption counts; retryability and same-lineage/catalog relations; and cursor-
rebind prepare/execute plus commit counts. Instrumentation must first self-
probe clock-read/evidence-consume/authority-mint as `1/1/1`, preventing an
unwired all-zero implementation from passing. Every initial-publication case
must then prove real cursor-rebind prepare/execute/commit `0/0/0`. Opaque
addresses, runtime-private epoch numbers and adapter API-call counts are
excluded from cross-runtime comparison.

The accepted executable closure is the normative fixture, strict JSON schema,
trusted-digest validator, malicious re-sign suite and protocol narrative
agreeing on digest
`c2ffa4100e73f823de0cfba8ae4b379ef00736b104d41988753b588b5d082eb8`,
23 ordered stages, two verification rules, 34 exact objects, 12 precedence
objects, 141 hostile obligations, 20 fault boundaries, 25 cancellation labels,
19 statement boundaries, eight cleanup faults and 28 parity fields. The strict
validator accepts the fixture with implementation and active-manifest claims
false. Any subsequent contract edit requires an intentional new digest,
malicious mutation coverage, documentation reconciliation and another
severity-zero review before implementation can consume it.

Production implementation now proceeds in bounded leaves, with no cursor-
rebind work mixed into the first leaf:

1. TypeScript implements package-private authority, clock tombstone, exact
   four-receipt chain, digest codec, post-DDL fence, reader lease, four
   consumed tombstones and stage-adoption receipt objects and registries.
2. TypeScript implements validation-first atomic mint/adoption intrinsics,
   fixed asset/SQL execution accounting, outer ledger, retry/poison split and
   hostile tests, stopping before cursor rebind and commit.
3. Python independently implements semantic parity and must not use
   `sqlite3.Connection.executescript()` for migration `0002`, because that API
   can implicitly commit the caller-owned transaction.
4. Both runtimes expose real measurement hooks and produce byte-stable
   normalized parity for success, retryable presentation failure, statement
   failure, catalog/count/ledger drift, cancellation and atomic-tail poison.
5. Verification includes focused hostile suites, full SQLite and Python
   regressions, fixture/schema/docs gates, exact packaged-asset byte checks,
   workspace lint/typecheck, Ruff/mypy, repeated flake-sensitive runs and
   independent severity-zero review.
6. Only after that evidence is complete may a separate leaf implement the
   derived publication session, one-shot cursor rebind and rules 11/12.

The active manifest remains unchanged until fresh-v2, v1-to-v2,
v0-to-v1-to-v2, cross-runtime upgrade/reopen, pre/post-commit crash recovery
and npm/wheel/sdist asset parity all pass. Contract acceptance therefore
unblocks the next private implementation leaf while preserving the hard
non-publication boundary.

#### 31.37.21 Append-only superseding B3 initial-publication closure and executable delivery lanes

The acceptance recorded in section 31.37.20 is preserved byte-for-byte as
history, but its `c2ffa410...` digest and 141-obligation registry are
superseded. A final independent implementation-readiness review proved that
six areas were still underspecified: multi-execution digest framing, terminal
reader proof ownership, per-hostile-case executable expectations, complete
normalized-output typing and vectors, physical-catalog serialization, and the
exact retry identity permitted for presentation failure versus cancellation.
No runtime implementation may cite section 31.37.20 as its contract anchor.

The sole accepted fixture anchor for the next production leaf is
`54b24cd31bcf221d0eff57dc0fa5e11e423f3b59bd0d7f6c29939e4027174fc7`.
It freezes exactly 145 unique hostile obligations and 145 corresponding
structured execution records with ordinals 1 through 145. The execution
registry digest is
`a241a3cb35bc88a29bf4662acc585ea3a7bcba5a61f5ea5d752dd267ad4c3936`
and the digest after expansion of every counter and semantic expectation is
`c268ad7bc583cf0cdfe9a2dfaee42bfd8af98491f3de1fa84362bdbcd5444d67`.
The contract remains `contract-frozen`, while implementation, protocol
completion, active manifest, production throughput and release claims remain
false.

##### 31.37.21.1 Exact portable initial-write digest codec

Both runtimes must implement one shared codec before any receipt type is
implemented. Parameter payloads are an outer execution-order array containing
inner parameter-order arrays. This two-dimensional framing is never elided:
zero executions is `[]`; one zero-parameter execution is `[[]]`; one
parameterized execution is `[[...]]`; multiple executions retain one inner
array per execution. Receipt code must not hash driver bind objects, Python
tuples, JavaScript objects, adapter call results or debug serialization.

Each scalar is tagged. Text is `{type:"text",value:string}` with no Unicode
normalization. Integer is `{type:"integer",value:canonical-decimal-string}`;
negative zero, exponent notation, leading plus and redundant leading zero are
rejected. BLOB is `{type:"blob",value:unpadded-base64url}`. Null is exactly
`{type:"null"}`. Booleans, floats, arrays, maps, undefined values and
runtime-specific integers outside the accepted range are rejected before
hashing. Object keys follow the project's Unicode-code-point canonical JSON
profile, arrays retain order, UTF-8 is strict and the domain bytes are joined
directly to the canonical JSON bytes without a delimiter.

The parameter domain is
`graph-engineering/sqlite-initial-write-parameters/v1\0`. The result domain is
`graph-engineering/sqlite-initial-write-result/v1\0`, and the sole result
shape is `{affectedRows:"canonical-nonnegative-decimal"}` for the complete
logical receipt. It is not an array of driver results. `lastInsertRowid`,
adapter-call count and statement-handle identity are excluded. The following
five vectors are mandatory in TypeScript and Python unit tests:

1. `[[]]` parameter digest
   `8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a`;
2. mixed Unicode text, negative integer, BLOB and null digest
   `8fcf64e97e9fda027b287997e43efc5226b596207dfc56ed161e46859027c271`;
3. two-execution digest
   `379049937f6797daade28d4b963dcc865f51afa5fa3422b90f4e505deaad838e`;
4. zero affected rows result digest
   `7d4e42c580be36f078371942187c0bdf048da4ffa35556c3f219f5930c5abd62`;
5. three affected rows result digest
   `9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417`.

The codec tranche must include duplicate/corrupt UTF-8 rejection, scalar tag
substitution, array-level deletion, execution reordering, parameter
reordering, NFC/NFD distinction, padded/standard-base64 rejection,
integer/text confusion, result aggregation drift and domain substitution.
Differential output is compared byte-for-byte before receipt code is allowed
to consume the codec.

##### 31.37.21.2 Exact post-DDL catalog-fence implementation

After the single logical execution of migration asset `0002`, and before any
baseline DML, the outer owner executes exactly:

`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE name GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`

The query digest is
`eb165659622f52a9be19858cc96d781c38aa6899e2b21e282bef4eb0d4e2b155`.
Implementations must not add a table/index filter: an owned-prefix view or
trigger is an attack and must change the observed inventory. Every row binds
exact `type`, `name`, `tableName` and SHA-256 of SQLite's exact UTF-8 SQL text.
Rows are encoded as a canonical JSON array; per-row object keys are `name`,
`sqlSha256`, `tableName`, `type`. The domain is
`graph-engineering/sqlite-target-physical-catalog/v1\0`.

The only valid inventory contains 34 explicit objects, encoded in 5,785 bytes,
with digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`,
`application_id = 1195724359` and `user_version = 2`. The proof must agree for
fresh v2 and v1-to-v2 construction in both SQLite bindings. `rootpage` remains
excluded because allocator history changes it; autoindexes with null SQL are
excluded because their defining uniqueness remains committed by owning-table
SQL. Extra, missing, duplicate, renamed, equal-count-replaced or SQL-mutated
owned objects fail.

The post-DDL fence is opaque, module-minted, connection- and transaction-
lineage-bound and reusable only inside the same live outer authority graph.
It is not the retired B2 v1 fence, not a final semantic proof and not a write
receipt. Clone, substitution, replay, watermark drift or catalog drift poisons
the transaction once permanent work has begun.

##### 31.37.21.3 Reader lease and terminal proof implementation

The baseline-entry reader gets one package-private lease with exactly five
states: minted-unused, reader-active, reader-closed, retired and poisoned. It
may execute only the frozen ordered TEMP-stage SELECT, may have at most one
active cursor, grants no permanent-write or adoption authority and must
rederive ordinal, entry hash, first hash and final root from the exact B2
projection. The implementation records prepare, ownership acquisition,
execute/fetch and close attempts separately.

Failure before cursor ownership requires zero closes. Once ownership begins,
success, cancellation and primary failure require exactly one immediate close
attempt. A successful close produces an opaque retired/closed terminal proof;
a close failure poisons the authority and requires outer rollback. Primary row
decode/hash error wins over close error, close error wins over cancellation,
and all reader cleanup precedes TEMP and outer cleanup.

The terminal proof must be structurally unavoidable. The baseline-entry
receipt binds its object identity and close evidence; the ordered four-receipt
adoption bridge presents the same object; the stage-adoption receipt copies
that identity. Active, missing, cloned, substituted, replayed, cross-run,
wrong-lineage and failed-close proofs are rejected before any receipt is
consumed. Unit tests must show the lease cannot be reused after retirement,
cannot open a second reader and cannot mint an adoption receipt.

##### 31.37.21.4 Four initial receipts and outer ledger

The TypeScript tranche first introduces package-private types and registries
without wiring cursor rebind. It then implements one validation-first write
intrinsic for each ordered receipt: migration `0002`, baseline entries,
baseline header and sequence zero. Each receipt commits connection identity,
unchanged BEGIN EXCLUSIVE lineage, outer-authority identity, exact predecessor,
SQL/asset identity, parameter/result digests, prepare/execute/affected counts,
`total_changes` before/after/delta, and the three outer-ledger dimensions.

Migration `0002` is one logical asset execution containing 20 fixed statements;
adapter call count is non-normative. Its ledger delta is logical writes 1,
fixed statements 20 and affected rows `1 + legacyOperationCount`. Baseline
entries prepare once and execute once per entry. Header and sequence zero each
prepare/execute once and affect exactly one row. After E entries and L legacy
operations the complete ledger is logical writes 4, fixed statements
`22 + E`, and affected rows `4 + E + L`.

The frozen success probe uses E=12 and L=1, therefore its exact ledger is
`4/34/16`. Its four-write arrays are prepares `[20,1,1,1]`, executes
`[1,12,1,1]`, affected rows `[2,12,1,1]` and `total_changes` deltas
`[2,12,1,1]`. Provider clock read, clock evidence consume and authority mint
are `1/1/1`; post-DDL fence mint is one; reader mint/close is `1/1`; receipt
mint/consume/tombstone is `4/4/4`; adoption receipt mint is one; rebind prepare,
rebind execute and commit are `0/0/0`.

Python implements the same objects independently after the TypeScript seam is
reviewed, but consumes the same fixture and emits the same normalized wire
record. Python must not use `sqlite3.Connection.executescript()` for `0002`
because it may violate caller-owned transaction control. Both runtimes must
prove exact asset bytes from source and packaged artifacts before publication
code can reference them.

##### 31.37.21.5 Atomic adoption retry/poison boundary

Initial adoption validates the complete ordered four-receipt bundle, all
predecessors, outer authority, lock, connection, transaction, post-DDL fence,
reader terminal proof, counts, `total_changes` and all ledger watermarks before
consuming any receipt. Presentation errors—missing, duplicate, reordered or
wrong-shape bundle members—consume zero and permit retry only with a corrected
complete bundle. Cancellation before the atomic tail consumes zero and permits
retry of the same untouched exact valid bundle.

Authority, lineage, lock, catalog, count, result-digest or ledger corruption is
not a retryable presentation error. It poisons the owner and requires rollback.
Once consumption begins, no cancellation or test fault may be injected. The
non-interruptible tail consumes all four receipts, mints four tombstones,
updates stage watermarks, retires only B2's old v1 catalog/change fence,
preserves the post-DDL fence and mints one stage-adoption receipt. Any API shape
that can expose a half-consumed bundle is forbidden.

Tests must distinguish corrected-bundle retry, same-valid-bundle cancellation
retry, replay after successful consumption, tombstone substitution,
cross-transaction replay and rollback/rebegin. No test may simulate success by
directly constructing opaque receipt objects or mutating a registry behind the
intrinsic.

##### 31.37.21.6 Hostile registry execution and parity evidence

Every hostile record is executable data, not a documentation label. The two
runtimes iterate ordinals 1 through 145 in fixture order, register each exact
hook, perform the specified mutation, assert the stable error code derived
from frozen boundary precedence and compare all semantic expectations. A run
with a skipped ID, duplicate ID, unavailable hook, copied expected output,
unobserved counter or registry-order drift fails before summary generation.

Counter profiles are expanded into the complete 28-field normalized record
before comparison. The output schema fixes the type of every field and exact
four-element arrays. At minimum, byte-stable parity covers successful initial
publication, invalid-adoption retry and post-`0002` catalog poison. The
self-probe must deliberately produce non-zero clock/authority/write/fence/
reader/receipt/adoption observations so an unwired zero-valued recorder cannot
pass. All cases stopping before rebind must retain rebind prepare, rebind
execute and commit at zero.

The hostile runner must capture actual hook registration and activation
counts, not only assertion counts. Atomic-tail obligations prove that no hook
can be registered inside the tail; they must not introduce an interruption
point that contradicts the protocol. TypeScript/Python result serialization is
canonical JSON and comparison rejects extra, missing, reordered or mistyped
fields.

##### 31.37.21.7 Parallel implementation sequence

The maximum safe development topology is four coordinated lanes with
non-overlapping ownership:

1. contract/fixture guardian owns only the immutable fixture, schema,
   validator, malicious mutations and protocol narrative;
2. TypeScript owner builds private authority/receipt/fence/reader/adoption
   primitives and focused tests;
3. Python owner independently builds the same private semantics and focused
   tests; and
4. evidence owner builds differential runners, artifact-byte probes, hostile
   coverage accounting and release-truth checks.

The main Agent serializes shared fixture changes, watches every lane for scope
drift, reruns cross-lane gates after each handoff and records command, result,
digest and unresolved risk in `codex_logs`. Agents may not concurrently edit
the same file. A lane that uncovers a contract ambiguity stops implementation,
reports the exact path and resumes only after the fixture guardian produces a
new reviewed digest. Progress scanning is evidence-based: unchanged commits
are not considered slow if a long full regression is running, while a lane
without file/test evidence receives a bounded follow-up task.

Implementation remains split into independently reviewable commits:

1. portable codec plus golden vectors;
2. private B2 transfer/adoption seam and outer authority objects;
3. TypeScript post-DDL fence and reader terminal proof;
4. TypeScript four-write receipt ledger and atomic adoption;
5. Python independent parity implementation;
6. executable 145-case cross-runtime hostile campaign;
7. artifact/crash/reopen evidence for this pre-rebind boundary; and only then
8. a separate publication-session, cursor-rebind and rules 11/12 leaf.

No commit combines contract correction with production behavior. Each commit
uses author and committer `reacher-z <mtrxcop@gmail.com>`, has no co-author
trailers, stages only owned files, passes `git diff --check` and pushes only
after local/upstream/remote hashes are proven equal.

##### 31.37.21.8 Required verification and acceptance gates

Contract acceptance requires strict JSON parsing, JSON Schema compilation,
canonical digest verification, malicious re-sign resistance, registry and
expanded-expectation hash checks, catalog recomputation in Node and Python,
fixture validation, link validation, descriptor parity, full SQLite contract
tests, workspace lint/typecheck and two independent severity-zero reviews.

Runtime acceptance adds focused unit tests for each lifecycle transition,
exact SQLite integration tests, all 145 hostile records in both runtimes,
byte-for-byte normalized parity, repeated cancellation/cleanup runs, complete
SQLite package regression, complete Python regression, Ruff format/lint,
strict mypy, npm/wheel/sdist asset parity, source versus packaged import tests
and negative public-export probes. Tests must use real SQLite transaction and
cursor objects wherever the contract claims real hooks.

Crash evidence remains bounded to this leaf: process termination before outer
commit must reopen as v1 with no accepted v2 publication; no test may claim
post-commit v2 recovery until rebind, rules 11/12, retirement and commit are
implemented. The active manifest and accepted-database path remain unchanged.

The leaf is accepted only when all of the following are simultaneously true:

- trusted fixture digest is the exact `54b24c...` value above;
- hostile obligations/records/unique IDs are 145/145/145;
- registry and expanded hashes recompute exactly;
- catalog inventory/count/bytes/digest and query digest recompute exactly;
- all three 28-field vectors validate with no extra properties;
- implementation and release claims remain false;
- scoped and full gates are green without unexplained skips or timeouts;
- plan HEAD prefix comparison succeeds and its diff has additions only;
- two final independent audits report HIGH 0 / MEDIUM 0 / LOW 0; and
- the scoped commit is pushed and the remote object matches local HEAD.

Passing this section does not complete Graph Engineering, B3 or the 21-day
master plan. It authorizes the first private pre-rebind runtime tranche only.
Cursor publication, rules 11/12, TEMP retirement, final commit, crash/reopen
v2 acceptance, scale/throughput evidence, manifest activation, stable release
and community-growth work remain explicit downstream deliverables.

#### 31.37.22 Append-only executable-oracle correction after adversarial schema review

Section 31.37.21 remains historical plan evidence, but its `54b24c...`,
`a241...`, `c268...` and `eb165...` anchors must not be implemented. Two
independent read-only audits proved that the first structured hostile registry
still used a non-executable template: 102 poisoned cases shared a generic
boundary, four counter profile names had no definitions, retry identity was
not per-record, and the catalog predicate missed ASCII case variants of
SQLite identifiers. Production implementation remained paused, and this
section supersedes those literals without modifying the earlier plan text.

The accepted contract anchors are now:

- domain-separated, zero-self fixture SHA-256
  `2d5a6287525753dda71d220d91c56da00b27a9c6e9c58a882fa12028fcb32205`;
- ordered 145-record registry SHA-256
  `4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`;
- fully resolved 145 by 28 expectation SHA-256
  `6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`;
- case-insensitive owned-catalog query SHA-256
  `bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`;
- unchanged valid 34-object catalog SHA-256
  `ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.

##### 31.37.22.1 Executable per-record oracle

The runtime campaign is driven by 145 ordered records, not by free-text
obligation names. Every record contains ordinal, stable ID, category, phase,
child boundary, parent precedence bucket, exact hook, exact mutation, stable
error code, counter-profile reference, retry-evidence mode, semantic profile
and seven semantic result fields. Ordinal, ID, hook and mutation are identity-
locked and remain in the same order as `hostileObligations`.

Twenty-five counter profiles are all referenced and each contains exactly the
20 counter fields that combine with `caseId` and seven semantic fields into
the frozen 28-field normalized record. No counter may be reported as
"observed at failure" without a concrete value. The representative progress
watermarks are:

1. before outer authority: every counter zero;
2. outer pre-tail: provider read one, evidence consume zero, authority mint
   zero;
3. outer active: provider/consume/authority `1/1/1`;
4. partial `0002` after fixed statement ten: prepare ten, execute one logical
   asset, fixed-ledger ten, no receipt;
5. complete `0002`: `[20,0,0,0]` prepares, `[1,0,0,0]` executes,
   `[2,0,0,0]` affected/delta, ledger `1/20/2`, one receipt;
6. post-DDL fence: previous counters plus one fence mint;
7. reader before ownership: mint one, close zero;
8. reader terminal: mint/close `1/1`;
9. partial baseline entries at six: ledger `1/26/8`, no entries receipt;
10. complete entries: ledger `2/32/14`, two total receipts;
11. complete header: ledger `3/33/15`, three receipts;
12. complete sequence: ledger `4/34/16`, four receipts;
13. partial adoption examples explicitly expose one consumed/no tombstone and
    four consumed/three tombstones as forbidden poisoned states;
14. complete adoption: consume/tombstone `4/4`, adoption mint one;
15. pre-rebind evidence rejected: provider/consume `2/1`;
16. pre-rebind evidence accepted: `2/2`;
17. rebind executed: `2/2`, rebind prepare/execute `1/1`;
18. pre-verification evidence rejected: `3/2`;
19. verification audits complete: `3/3`;
20. final pre-commit fence: `4/4` and commit zero;
21. forbidden fifth clock observation: `5/4`; and
22. commit-returned control: `4/4` and commit one.

Reader SQL/order/provenance cases use the reader-lifecycle parent bucket.
Permanent baseline INSERT failures use the after-statement parent bucket.
Outer-authority and stage-adoption atomic tails have separate boundaries, and
forbidden injection is rejected before entry rather than simulated as a
partial atomic state. Post-`0002` catalog drift uses the same exact profile and
boundary as its full parity control.

Retry mode is explicit per record. `corrected-complete-bundle` applies to
invalid adoption presentation and forbids replaying the invalid bundle.
`same-exact-valid-bundle` applies only to a valid bundle cancelled or rejected
before the non-interruptible tail. Equivalent outer-authority pre-tail cases
use exact valid authority evidence. Poisoned mutation requires
`fresh-authority-graph`; non-mutating provenance rejection is not represented
as bundle retry.

##### 31.37.22.2 Catalog namespace closure

The exact catalog query is now:

`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`

SQLite compares ASCII identifiers without case distinction, while `GLOB`
normally compares case-sensitively. Applying `lower()` to the name before the
literal-prefix glob closes the gap without relying on connection PRAGMAs.
The query continues to include every SQL-bearing type, not only tables and
indexes, so hostile views and triggers remain visible.

Independent Node/Python, fresh/migrated evidence must retain 34 rows, 5,785
canonical bytes and the `ca85...` digest. The hostile gate creates uppercase
and mixed-case views and triggers in the owned namespace and proves each one
changes the inventory and digest. It then creates unrelated objects and proves
they do not change the owned projection. The exact hostile cumulative digests
are evidence fixtures, not replacements for computing the result through real
SQLite.

##### 31.37.22.3 Signed-integer digest closure

The parameter codec accepts integer tagged values only in the SQLite signed
64-bit range. Lexemes match
`^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$`; `+1`, `01`, `-0`, surrounding whitespace
and values outside `[-9223372036854775808, 9223372036854775807]` fail before
canonical hashing. The minimum and maximum golden digests are
`d3d9b55872b8b14e2ec8a3c2b5ca27db179993b97ce9e47845efd2923eef4460`
and
`be263941652b27aa8254e518d3de8853c3071e7b7310449a7af13fb8bd2765ce`.
Together with the previous five vectors, both runtimes now have seven positive
goldens plus required rejection vectors.

##### 31.37.22.4 Exact schema and hash separation

The frozen case uses three independent domains and preimages. The registry
hash covers the exact ordered records array. The expanded hash covers 145
resolved 28-field records in registry order. The fixture hash covers the
entire fixture with only its own digest field replaced by 64 lowercase zeroes.
All three prepend their declared UTF-8 domain directly to canonical JSON.
Plain SHA-256 without the fixture domain is invalid even if every JSON byte is
otherwise correct.

The JSON Schema continues to expose reusable shape definitions, then adds a
root `exactFrozenFixture` constraint generated without object `const`.
Duplicate-safe parsing deliberately creates null-prototype objects; Ajv object
`const` deep comparison is therefore unsafe. The exact tree instead uses
closed required object properties, exact array `prefixItems`/length and scalar
constants for all 4,725 primitive leaves. Empty arrays omit `prefixItems` and
use exact zero length. Acceptance probes must reject every generated scalar
mutation, array shrink/grow/reorder and object extension while still compiling
under strict Ajv and accepting the null-prototype canonical case.

##### 31.37.22.5 Revised acceptance sequence

Before the first runtime leaf begins, the main Agent must complete these gates
in order:

1. synchronize validator constants and all three domain-separated hash
   algorithms;
2. validate the 25 exact counter profiles, 145 parent/child/retry mappings and
   full expansion algorithm;
3. independently recompute seven codec goldens and the catalog query hash;
4. run real Node SQLite uppercase/mixed-case view/trigger probes;
5. adapt malicious re-sign tests so schema-exact rejection and semantic
   trusted-anchor rejection are both tested intentionally;
6. pass the focused validator and hostile tests;
7. pass the complete SQLite ledger-contract suite;
8. pass fixture, documentation-link, descriptor-parity, lint and typecheck
   gates;
9. run two independent final reviews against the exact final working-tree
   bytes and require HIGH 0 / MEDIUM 0 / LOW 0;
10. verify the entire HEAD plan byte prefix and additions-only plan diff; and
11. stage only the eight B3 contract/log/plan files, commit as
    `reacher-z <mtrxcop@gmail.com>` without co-author trailers, push and prove
    local/upstream/remote object equality.

Only then may the next commit introduce package-private TypeScript behavior.
It still stops before cursor rebind and commit, follows the tranche order in
31.37.21, retains every implementation/release/manifest claim as false, and
does not imply that the complete 21-day plan or GitHub adoption objective has
been achieved.

#### 31.37.23 Append-only state-domain, validator-surface and canonical-order closure

Section 31.37.22 remains immutable historical planning evidence, but its
`2d5a6287...` fixture anchor and 4,725-leaf count are superseded by this
section. A final adversarial pass found that the reusable normalized-record
schema still admitted the stale state `cursor-published` even though the
authoritative state machine had replaced it with `publication-active` and
`cursor/clock-complete`. The same pass found that a test-oriented exported
semantic validator could be imported without first enforcing the exact JSON
Schema, and that the JavaScript canonicalizer used the platform's UTF-16
default key ordering while the protocol promises Unicode code-point ordering.
No runtime implementation may begin until all three contradictions are closed.

The final normalized state type literal is
`enum-state-machine-states`. Every normalized record state is a member of the
exact ordered state domain:

1. `pre-rebind-complete`;
2. `publication-active`;
3. `cursor/clock-complete`;
4. `poisoned`; and
5. `disposed`.

The reusable record schema, exact frozen fixture tree, semantic validator and
hostile expansion must all enforce that same set. No `cursor-published` alias,
legacy spelling, implicit compatibility value or unconstrained string is
accepted. The remaining semantic fields are equally explicit: `caseId` is a
non-empty stable string, `outcome` is exactly `success`, `rejected` or
`poisoned`, and `failureBoundary` is either null or a non-empty stable slug.
All four-element counter arrays, nonnegative safe-integer counters and Boolean
fields retain their previous exact validation.

The public validator surface is schema-first without exception. Tests may not
export, import or call a semantic-only entry point. A malicious object with an
extra member, including a member whose value would disappear during JSON
serialization, must fail exact schema validation before any trusted semantic
anchor is considered. Tests for maliciously re-signed data exercise the public
entry point and prove fail-closed `GE_CURSOR_B3_SCHEMA` behavior. The private
semantic implementation remains reachable only through that schema-first
entry and through canonical validation with asset verification enabled.

Canonical JSON key ordering is implemented by Unicode scalar value, not by
JavaScript's default UTF-16 code-unit order. The conformance suite includes a
non-ASCII regression that orders U+E000 before U+1F600 (`😀`), matching numeric
code-point order even though UTF-16 would reverse them. Fixture, ordered
registry and expanded-expectation hash implementations use the same comparator
and reject lone surrogate keys or values through the canonical Unicode-scalar
rules already frozen by the serialization contract.

After the state correction, the accepted domain-separated zero-self fixture
SHA-256 is
`32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993`.
The state-only correction does not alter the ordered registry SHA-256
`4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58`
or the 145 by 28 expanded expectation SHA-256
`6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95`.
The exact schema tree now contains 4,959 scalar leaves; mutation acceptance
requires rejection of all 4,959 scalar substitutions, 222 array-length
mutations, 195 valid array reorderings and 416 object extensions.

Final B3 contract acceptance therefore requires, on one stable byte set:

1. direct canonical validator success with real asset verification;
2. focused tests proving schema-first public validation, complete normalized
   field typing and Unicode code-point ordering;
3. the complete SQLite ledger-contract test suite;
4. all fixture, documentation-link and cross-runtime descriptor-parity gates;
5. workspace lint and typecheck across every package;
6. an additions-only master-plan diff whose entire HEAD byte prefix is exact;
7. two independent final audits reporting HIGH 0 / MEDIUM 0 / LOW 0;
8. an explicit eight-path index with no unrelated user or parallel-lane file;
9. a commit authored and committed by `reacher-z <mtrxcop@gmail.com>` without
   co-author trailers; and
10. equality of local HEAD, configured upstream and the remote branch object.

This correction authorizes only the next package-private TypeScript B2
transfer/adoption seam after the B3 contract commit is pushed. That runtime
tranche must preserve one connection and transaction lineage, consume each
initial write receipt exactly once, mint the adoption receipt atomically, and
stop in `pre-rebind-complete`. It must not execute cursor rebind, rules 11/12,
TEMP retirement or commit; those remain separate reviewed tranches with their
own hostile and crash/reopen evidence. Graph Engineering delivery, production
claims, active-manifest support and community-growth targets remain open.

#### 31.37.24 Append-only B3 outer-publication authority runtime acceptance

The package-private TypeScript outer-publication authority seam is accepted on
2026-07-29. This section only appends acceptance evidence and the next bounded
implementation order; it does not alter or weaken any preceding B3 contract,
release gate, nonclaim or hostile requirement.

The accepted seam takes one exact completed B2 object graph and performs the
smallest atomic ownership transition required before permanent migration work.
Its bounded input is the exact connection, TEMP stage, pre-rebind receipt,
projection identity, B2 ownership transfer, migration-lock capability,
provider-clock capability and first-boundary clock evidence. Preparation binds
those identities without consuming the evidence. Activation consumes that one
evidence, retains its exact tombstone, publishes the already-prepared stage
transfer through a private continuation and marks one reusable outer authority
active. It performs no SQL and advances no database counter.

The continuation is an opaque package-private object held only in WeakMap
registries. The prepared assertion arms it after every fallible B2, owner,
lineage, lock, clock and cancellation check. Publication first resolves the
exact continuation and rejects missing, forged, retired or replayed values
before entering its assignment-only tail. The tail then deletes the
continuation, publishes the exact stage/authority identity and advances the
transfer lifecycle. No caller can substitute an arbitrary transfer/authority
pair at this boundary.

Cancellation remains the sole retryable inactive exit. An already-cancelled
valid signal fails before the continuation is armed and before clock evidence
is consumed. The same exact authority and evidence may then be retried without
minting a replacement graph. Invalid cancellation presentation is a caller
error and cannot poison an unrelated registered authority.

Every invariant failure after exact authority lookup is terminal. Loss or
replacement of the transaction lineage, including rollback followed by a new
EXCLUSIVE transaction, retires the authority and the stage/transfer graph.
Clock-sequence drift, graph substitution, unexpected epoch/`total_changes`
movement or another non-stale invariant failure poisons all three in-memory
owners. A later provider-clock boundary therefore cannot leave an inactive
ghost that can be retried. A retired or poisoned authority cannot be activated
or asserted a second time.

Evidence consumption is exception-safe at the one-way boundary. The
implementation captures `Object.create` and `Object.freeze` at module load,
constructs the opaque tombstone and immutable tombstone state, registers that
state, and only then changes evidence to `consumed=true`. A construction or
registration failure therefore leaves evidence unconsumed; successful
consumption always has a retained exact tombstone. Ambient replacement of the
two Object intrinsics after import cannot enter this tail.

Retirement also burns any armed continuation before applying its
assignment-only stage lifecycle transition. This ordering is mandatory: a
captured tail from a prepared authority must never be able to republish a
retired graph. The bridge-level adversarial oracle directly arms a tail,
retires its exact pair, attempts publication twice and proves structured
rejection plus absence of owned state. A companion oracle publishes once,
rejects replay and proves the successful ownership remains intact.

Active-authority assertion deliberately differs from activation preparation.
Preparation retains the complete old B2 epoch and `total_changes` fence because
no permanent write is yet authorized. Active assertion checks the stable stage,
transfer, authority, receipt, projection, connection, transaction lineage,
migration lock and clock tombstone graph, plus the outer authority's mutable
current transaction-epoch and change-counter watermark. It does not call the
obsolete pre-`0002` B2 fence. A later reviewed write-ledger implementation can
atomically advance the current watermark together with its authenticated write
receipt, while unauthorized movement remains detectable.

The final adversarial suite contains fourteen focused outer-authority cases and
eight focused clock-authority cases. It covers exact activation and snapshot,
cancellation retry, clone and cross-run substitution, preconsumed evidence,
unfinished and diagnosed B2 graphs, all identity substitutions, later-boundary
poisoning, inactive and active rollback retirement, hostile ambient intrinsics,
retired-tail burn, successful-tail replay, zero SQL/permanent write/transaction
control, and runtime plus TypeScript root-export isolation. The package root is
checked both as a runtime namespace and as source text so type-only private
interfaces cannot escape unnoticed.

Acceptance evidence on one final byte set is:

1. outer-authority focused tests 14/14 passed;
2. provider-clock focused tests 8/8 passed;
3. the complete SQLite package suite passed 859/859 tests across 24 files;
4. SQLite package typecheck and lint passed;
5. workspace typecheck and lint passed across all eight implementation
   packages;
6. additions and whitespace validation passed;
7. the final independent scope audit reported HIGH 0 / MEDIUM 0 / LOW 0; and
8. the exact review record is
   `codex_logs/reviews/SQLITE-CURSOR-B3-OUTER-AUTHORITY-2026-07-29.md`.

This acceptance authorizes only the next smallest production leaf in the
ordering already frozen by section 31.37.21.7: the package-private TypeScript
portable initial-write digest codec plus its seven golden vectors and hostile
rejection vectors. The codec leaf must be pure. It may implement tagged scalar
encoding, two-dimensional execution framing, Unicode scalar-value canonical
ordering, signed 64-bit integer bounds, unpadded base64url and the two
domain-separated SHA-256 digests. It must not execute migration `0002`, write a
permanent table, create the four-write receipt ledger, perform rebind, enforce
rules 11/12, retire TEMP state or commit. Post-DDL fence/reader proof remains
the following independently audited leaf.

The accelerated three-day publication objective is a source-only alpha preview,
not a formal release-candidate claim. Formal RC wording remains forbidden until
the repository's evidence-closure overlay selects a real candidate and all
required release-weight gates close. GitHub popularity and a 5K-star outcome
remain product/community goals rather than testable delivery guarantees.

#### 31.37.25 Append-only portable initial-write digest codec acceptance

The first production leaf authorized by section 31.37.24 is accepted on
2026-07-29. This acceptance covers only a package-private, pure TypeScript
codec and its executable oracle. It does not authorize SQL, migration `0002`,
permanent writes, receipt minting, post-DDL proofs, cursor rebind, TEMP
retirement or transaction completion.

The accepted parameter carrier is strictly two-dimensional. Its outer array
preserves logical execution order and every inner array preserves parameter
order for that execution. Zero executions encode as `[]`; one execution with
zero parameters encodes as `[[]]`. Neither dimension may be flattened,
inferred or omitted. Reordering an execution or parameter is a different valid
carrier with a different digest, while deleting a level or presenting a sparse
or non-array frame is a structured rejection.

The accepted scalar union contains exactly four tagged shapes. Text is an
exact `{type:"text",value:string}` carrier, preserves Unicode scalars byte for
byte and performs no NFC/NFD normalization. Integer is an exact
`{type:"integer",value:string}` carrier with canonical signed 64-bit decimal
syntax and bounds. BLOB is exact `{type:"blob",value:string}` using canonical
unpadded RFC 4648 section 5 base64url. Null is exact `{type:"null"}` and must
not carry a value. Boolean, number, bigint, undefined, function, collection,
date, nested array and unknown tag presentations are rejected.

The result carrier is exactly `{affectedRows:string}`. It represents the
complete logical receipt aggregate rather than a per-execution driver result
array. Its value is canonical nonnegative decimal: zero is `0`, positive
values have no plus sign or redundant leading zero, and negative, exponent,
fractional or whitespace forms are forbidden. Because the frozen contract does
not declare a maximum, this leaf deliberately treats the result as an
unbounded lexical decimal instead of imposing JavaScript safe-integer, uint64
or signed-int64 limits. `lastInsertRowid`, adapter-call counts and statement
identity remain excluded.

This implementation boundary accepts structured runtime values only. It does
not expose a second raw JSON or raw UTF-8 byte decoder. Duplicate JSON keys and
corrupt UTF-8 are therefore enforced by the already frozen strict fixture and
parser gates, where those attacks are representable, rather than guessed in a
runtime value API where they are not. A later raw-byte API would require its
own append-only contract, fatal UTF-8 decoder and duplicate-safe parser before
implementation.

The BLOB boundary follows canonical RFC encoding by round trip. Empty string is
the accepted canonical representation of zero bytes. Padding, `+` or `/`,
whitespace, length congruent to one modulo four, and two- or three-character
aliases with non-zero unused pad bits are rejected. These choices are identical
for the future Python implementation and cannot be delegated to the differing
leniency of default runtime decoders.

The digest preimages use the exact fixed NUL-terminated domains:

- `graph-engineering/sqlite-initial-write-parameters/v1\0`; and
- `graph-engineering/sqlite-initial-write-result/v1\0`.

Each lowercase SHA-256 is computed over domain UTF-8 bytes immediately followed
by canonical JSON UTF-8 bytes, with no extra delimiter, length prefix, newline
or adapter serialization. The seven current case/schema vectors, including
signed-int64 minimum and maximum, are the sole known-answer set. The historical
dead one-dimensional constant still present in the validator source is not a
live validation dependency and must not be copied by either runtime; fixture-
guardian cleanup of that constant remains a separate contract-maintenance
change.

Runtime validation is descriptor-safe and fail-closed. Ordinary dense arrays,
plain objects and null-prototype exact objects are accepted. Live or revoked
proxies, accessors, inherited carriers, symbol keys, non-enumerable extras,
sparse arrays and extra properties are rejected without invoking caller traps
or getters. Errors are structured provider invalid-argument failures and occur
before hashing.

The serializer is local and fixed-shape. This avoids allowing ambient driver,
debug or generic object serialization to reinterpret a protocol carrier. It
captures the required descriptor/prototype, JSON string, character, Buffer,
Reflect and Hash intrinsics at module initialization and uses explicit loops.
Hostile replacement after import of `Object.keys`, array map/sort/some,
`RegExp.prototype.test`, `Object.freeze`, global `BigInt` and `Buffer.from`
cannot alter acceptance or any of the seven known-answer outputs.

Integer validation performs sign and leading-digit checks, rejects magnitudes
longer than the signed-int64 boundary before scanning caller-sized content, and
uses bounded lexicographic comparison for the two 19-digit limits. It never
constructs an attacker-sized BigInt. The hostile oracle includes a 100,000-
digit input that is rejected by the length fence.

Acceptance evidence on one final byte set is:

1. all seven frozen canonical JSON and digest vectors matched exactly;
2. the focused codec suite passed 13/13;
3. the B3 schema/fixture conformance suite passed 34/34;
4. the complete SQLite package suite passed 872/872 tests across 25 files;
5. workspace typecheck and lint passed across all eight implementation
   packages;
6. whitespace and additions checks passed;
7. independent final production/test audit reported HIGH 0 / MEDIUM 0 / LOW 0;
   and
8. the durable review record is
   `codex_logs/reviews/SQLITE-CURSOR-B3-INITIAL-WRITE-DIGEST-CODEC-2026-07-29.md`.

The next independently reviewed production leaf is the TypeScript post-DDL
physical-catalog fence plus publication reader lease and terminal proof. It
must continue to stop before the four-write receipt ledger, stage adoption,
cursor rebind, rules 11/12, TEMP retirement and commit. The three-day public
preview acceleration does not weaken this dependency order or convert these
nonclaims into release evidence.

#### 31.37.26 Append-only post-DDL dependency-DAG correction

The delivery batch order in section 31.37.21.7 is corrected before further
production behavior is written. The protocol object graph itself is acyclic,
but grouping the post-DDL fence and reader into item 3 while grouping all four
initial write receipts into item 4 created a batch-level cycle. The fence is
required to bind the exact migration-`0002` receipt, while the later three
write receipts are required to bind the fence and reader terminal proof. It is
therefore impossible to implement those two old batch items in their written
order without inventing a placeholder authority.

The sole valid object and implementation order is now:

1. active outer publication authority and portable initial-write digest codec;
2. a pure, non-authorizing target physical-catalog observation codec;
3. vendored and verified migration `0002` execution, atomic outer authority
   epoch/`total_changes`/three-ledger watermark advancement, and authentic
   `migration0002CatalogRebuildReceipt` mint;
4. exact physical-catalog observation after that receipt followed by
   receipt-bound post-DDL fence mint;
5. post-DDL publication reader lease, exact-one cleanup and terminal proof;
6. baseline-entry receipt using that terminal proof;
7. baseline-header and operation-sequence-zero receipts; and
8. validation-first atomic consumption/adoption of the exact four-receipt
   bundle.

No structural placeholder, test-only registry insertion, caller-supplied
receipt, fresh-v2 observation, cloned object or type assertion may replace the
authentic migration receipt at steps 3 and 4. Fence/reader tests that require
receipt identity remain blocked until the real executor and receipt exist.

The current outer authority reinforces this dependency. It owns mutable
current transaction epoch and `total_changes` watermarks but exposes no
unauthenticated advance operation; its snapshot ledger remains zero. Executing
`0002` without the atomic ledger/receipt transition would make the next active
assertion correctly classify the database movement as unexplained drift and
poison the graph. The fix is the authenticated step-3 write transition, not a
weaker authority assertion.

The current authoritative physical-catalog query supersedes the old query text
and hash in section 31.37.21.2. It is exactly:

`SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY`

Its SHA-256 is
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
The `lower(name)` predicate is mandatory. Uppercase and mixed-case owned-prefix
views and triggers are hostile catalog members and must alter the observation;
the former case-sensitive `name GLOB` query and `eb165659...` digest are
historical and forbidden for implementation.

The target observation contract is exact: 34 ordered rows, 5,785 canonical
UTF-8 bytes, application ID `1195724359`, user version `2`, domain
`graph-engineering/sqlite-target-physical-catalog/v1\0`, and final digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
Each row is serialized with keys `name`, `sqlSha256`, `tableName`, `type`.
`sqlSha256` hashes SQLite's exact SQL text bytes without whitespace
normalization. Null-SQL autoindexes are excluded by the query, and unrelated
non-owned objects do not enter the projection.

Before the migration receipt exists, the next authorized production leaf is
only `cursor-publication-target-catalog.ts`, a package-private and
non-authorizing observation codec. It may freeze the query/domain/target
constants and 34-entry inventory, strictly decode exact four-column rows,
compute per-row SQL hashes, produce the canonical row serialization, verify
count/bytes/digest/inventory/application/user version, and return a plain
diagnostic snapshot for internal tests and future fence construction.

That observation result must not be opaque, named as a fence, registered as an
authority, accepted by a writer/adoption bridge or treated as proof that
`0002` executed. The module must not import or execute the migration asset,
advance the authority, run DML, mint a reader lease, read the TEMP projection,
rebind a cursor or control a transaction. Runtime tests must enforce this
negative boundary through package-root export checks and a static/dynamic SQL
allowlist.

Existing catalog utilities cannot be reused blindly. The v1 migration and
semantic-integrity catalog hashes select a different object set and normalize
SQL whitespace; both violate the physical fence contract. Existing captured
connection prepare/owner/change intrinsics may be reused. The old pre-B2
ordered TEMP handoff reader also cannot become the post-DDL reader: it binds the
old epoch/change fence, is already consumed, and uses a differently formatted
SQL literal whose byte digest is not the frozen reader query digest.

The future reader must own a new exact single-line TEMP SELECT constant with
the frozen digest, even when it reuses the old row decoder, accumulator and
iterator-cleanup algorithms. It also requires a dedicated cleanup bridge from
the reader lifecycle into the stage/outer-authority lifecycle. Cleanup must
close an acquired cursor exactly once before TEMP disposal or authority poison;
a close failure has the frozen precedence and requires rollback. The completed
old handoff cleanup slot may not be reused.

The immediate acceptance gates for the pure target-catalog leaf are exact
constant/query hashing, all 34 inventory entries, exact canonical length and
digest, strict row/Unicode/text handling, case-insensitive owned-prefix hostile
objects, unrelated-object exclusion, root export isolation, read-only SQL
allowlisting, complete SQLite regression, conformance locks, workspace
typecheck/lint and independent HIGH 0 / MEDIUM 0 / LOW 0 review. Passing that
leaf authorizes the authentic migration executor/receipt tranche only; it does
not authorize a fence or reader.

The durable dependency review is recorded in
`codex_logs/reviews/SQLITE-CURSOR-B3-POST-DDL-DEPENDENCY-AUDIT-2026-07-29.md`.
This append-only correction preserves the three-day source-preview objective
without manufacturing completion evidence or weakening any publication,
crash/reopen, active-manifest or release gate.

#### 31.37.27 Append-only target physical-catalog observation acceptance

The pure, non-authorizing target physical-catalog observation leaf authorized
by section 31.37.26 is implemented and independently accepted. The production
surface consists of
`packages/sqlite/src/cursor-publication-target-catalog.ts` plus a closed-set
captured-native read bridge owned by `packages/sqlite/src/sqlite-connection.ts`.
Neither the observation API nor its connection intrinsics are exported from
the SQLite package root.

The accepted catalog identity is unchanged from the correction above. The
sole catalog SELECT is the exact `main.sqlite_schema` query with
`lower(name) GLOB 'ge_cycle_*'`, binary type/name ordering and non-null SQL.
Its query hash remains `bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
The accepted target remains 34 ordered rows, 5,785 canonical UTF-8 bytes,
catalog digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`,
application ID `1195724359` and user version `2`. All 34 full inventory
identities are frozen in production and compared individually; aggregate
digest equality cannot conceal a missing, duplicate, renamed, reordered or
equal-count replacement object.

The canonical carrier is a JSON array whose row keys are emitted only in the
order `name`, `sqlSha256`, `tableName`, `type`. `sqlSha256` covers the exact
SQLite SQL text UTF-8 bytes. The implementation performs no SQL-text
normalization and no runtime sort. Uppercase and mixed-case owned-prefix views
and triggers enter the projection; unrelated objects do not. Null-SQL
autoindexes remain excluded by the fixed query.

Observation and authorization are deliberately separate. A snapshot is an
ordinary, detached, deeply frozen structural value that may describe a
non-target catalog. It is not registered, branded, opaque or identity-bearing.
Only the explicit validator applies the expected versions, count, bytes,
query hash, inventory and aggregate digest. Malformed caller carriers fail as
invalid arguments; well-formed physical drift fails as corruption. No writer,
adoption bridge, authority, receipt, fence or lease accepts the snapshot.

The database read is bounded to 35 rows, one more than the exact target. It
never materializes an unbounded `.all()` result. Every acquired native iterator
is returned exactly once. Fetch/row failure stays primary over close failure,
and raw driver failures are translated into the provider error taxonomy. The
metadata read is a second fixed SELECT over
`main.pragma_application_id()` and `main.pragma_user_version()`. Explicit
`main` qualification and function-call syntax prevent hostile TEMP tables from
shadowing either table-valued pragma.

The connection read bridge is not a generic SELECT escape hatch. Its runtime
input is a closed two-value kind whose branches select the two package-owned
SQL constants; arbitrary SQL, DML, PRAGMA, stacked statements and caller
strings cannot reach the captured native prepare path. The target module
aliases the connection-owned catalog constant, so declared and executed query
text have one source rather than duplicate literals.

The native trust root captures `DatabaseSync.prepare` and `close`, the four
StatementSync hardening setters, StatementSync `get` and `iterate`, and
`Reflect.apply`. It does not allocate a database at module import. The first
real connection initializes native iterator `next` and `return` from an owned
probe. Capture walks the prototype chain, rejects Proxy and non-native/bound
wrappers, checks the exact native function source, executes a two-step
row-then-terminal brand probe, and closes the probe through the captured
return. A failed capture is not cached. Constructor cleanup uses captured
native close and preserves the already translated primary failure.

This trust-root strengthening is required by the observation contract, not a
new public connection feature. A public `SQLiteConnection.prepare` override,
a forged prototype-only connection, post-import replacement of
DatabaseSync/StatementSync/iterator methods, replacement of `Reflect.apply`,
an Array numeric-index setter and a same-name foreign native iterator `next`
all fail to intercept or forge the read. A closed real connection retains its
structured unavailable classification.

Input decoding follows the captured-descriptor standard used by the portable
initial-write codec. Only ordinary dense arrays and exact plain/null-prototype
row objects are accepted. Proxies, revoked proxies, accessors, sparse or
subclass arrays, symbols, inherited/extra fields, wrong scalar types and lone
surrogates are rejected without calling traps or getters. Explicit indexed
loops and captured `Object.defineProperty` avoid ambient array iteration,
`includes`, `push`, `join` and numeric prototype setter interference.

Acceptance evidence on the completed leaf is:

1. target catalog focused tests passed 19/19;
2. target catalog plus connection tests passed 38/38;
3. the frozen B3 conformance suite passed 34/34 and its validator retained
   `implementationClaim: false` and `activeManifestClaim: false`;
4. the complete uncontended SQLite suite passed 26 files and 891/891 tests;
5. workspace typecheck passed across all eight implementation packages;
6. workspace lint passed across all eight implementation packages;
7. whitespace/additions checks passed;
8. repeated, randomized and forced-concurrency focused runs found no flake;
9. independent final production/test audits reported HIGH 0 / MEDIUM 0 /
   LOW 0; and
10. the durable acceptance record is
    `codex_logs/reviews/SQLITE-CURSOR-B3-TARGET-CATALOG-OBSERVATION-2026-07-29.md`.

One earlier complete-suite attempt was intentionally excluded from acceptance:
it overlapped workspace typecheck and lint, and two pre-existing five-second
tests timed out under CPU contention. Those two files immediately passed
246/246 without contention, followed by the accepted complete run above.
This preserves an honest evidence chain rather than hiding or misclassifying
the failed timing run.

Passing this leaf authorizes only the next dependency-DAG tranche: vendor and
verify the exact 20-statement migration `0002` asset, execute it sequentially
inside the already-owned outer transaction, bind actual parameter/result
digests, atomically advance the outer authority transaction epoch,
`total_changes` watermark and three-field permanent-write ledger, and mint the
authentic single-use `migration0002CatalogRebuildReceipt`. That tranche must
define exact statement and affected-row evidence, cancellation/failure
precedence, retry behavior, receipt provenance, graph poisoning and rollback
requirements before production execution is enabled.

A post-DDL catalog fence remains forbidden until the authentic receipt exists.
The future fence must perform its own fresh read from the exact connection and
bind receipt identity, outer authority, transaction lineage, epoch, change
watermark and ledger. It may not accept this diagnostic snapshot or any caller
supplied equivalent. Reader lease/terminal proof, baseline entries/header/
sequence receipts, four-receipt adoption, cursor rebind, rules 11/12, TEMP
retirement and commit remain explicit nonclaims.

### 31.37.28 Exact migration 0002 execution, permanent-write accounting and authentic receipt closure (append-only execution record, 2026-07-29)

This append-only tranche turns the previously observed v2 target catalog into
an exact, connection-owned migration operation. It does not amend, reinterpret
or weaken any earlier requirement in this plan. Every line above the start of
this section remains the immutable planning baseline. The purpose of this
section is to record the additional implementation and acceptance work needed
between target-catalog observation and the later post-DDL fence.

The migration asset closure MUST contain four byte-identical packaged copies:

1. the npm-source migration at
   `packages/sqlite/migrations/0002-v1-to-v2-operation-replay.sql`;
2. the npm-source preview manifest at
   `packages/sqlite/migrations/manifest-v2.preview.json`;
3. the Python-package migration mirror at
   `python/src/graph_engineering/_sqlite_migrations/0002-v1-to-v2-operation-replay.sql`;
4. the Python-package preview-manifest mirror at
   `python/src/graph_engineering/_sqlite_migrations/manifest-v2.preview.json`.

The SQL asset identity is fixed at 9,523 bytes and SHA-256
`1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d`.
The preview-manifest identity is fixed at 4,908 bytes and SHA-256
`f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf`.
Loading either asset MUST fail closed for a missing/non-regular file, wrong
length, wrong digest, BOM, CR, invalid UTF-8, malformed JSON, unexpected schema
version, migration-entry drift or target-catalog identity drift. The preview
manifest is deliberately not the active release manifest. Its presence proves
the pending migration closure without falsely advertising a publicly active v2
database release.

The TypeScript asset loader MUST expose no forgeable plain-object credential.
It owns frozen, null-prototype proof values backed by private weak identity,
captures the filesystem/hash/Buffer/string/JSON/Object/Reflect intrinsics used
by verification, parses exactly twenty non-empty SQL statements, and verifies
that the parsed preview manifest binds the same migration filename, bytes,
digest, target application id, target user version and target schema SQL
identity as the runtime migration contract. A caller-supplied lookalike, copied
object or prototype-mutated value MUST NOT pass as an authentic asset or
manifest proof.

The connection bridge MUST remain a closed-set capability rather than a raw SQL
executor. Migration 0002 receives an opaque session issued only to the exact
activated connection. Session issuance MUST reject closed databases, wrong
connections, wrong transaction lineages, missing outer transactions and any of
the twelve TEMP catalog names that could shadow an unqualified migration table
or index. The preflight is itself a fixed package-owned query. Callers cannot
substitute query text, names, parameters or statement order.

Execution MUST be strictly sequential and next-only:

1. prepare statement 1 with the captured native prepare;
2. configure it with captured hardening setters;
3. advance the connection transaction epoch immediately before native run;
4. execute native run exactly once;
5. record irreversible completion before any later counter observation;
6. read the package-owned `total_changes()` counter;
7. validate the statement-local change count and cumulative delta;
8. proceed to statement 2 only after statement 1 is completely accounted;
9. repeat through statement 20 without pre-preparing later statements; and
10. permanently retire the session on success or any error.

This ordering is an authority requirement, not an implementation detail. If
native `run()` changes SQLite state and a subsequent `total_changes()` read
fails, the snapshot MUST still show that statement as completed and its epoch
as consumed. The counter read failure remains the primary surfaced failure,
while best-effort synchronization is permitted only to improve internal
evidence. No failure after a native write may roll the authority counters back
to their pre-statement values.

SQLite's `StatementSync.run().changes` can represent the most recent write in
ways that are unsafe as a standalone migration ledger. Therefore the executor
MUST reconcile the safely decoded own `changes` field with captured
`total_changes()` deltas on the two data-writing statements. For a legacy
operation count `L`, the exact statement affected-row vector is:

`[0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,L,0,0,0]`.

Statement 4 writes exactly one schema row. Statement 17 copies exactly `L`
legacy operation rows. Every other statement has a zero permanent-row delta.
The aggregate permanent-write delta is exactly `1 + L`. Before starting,
`L` and `1 + L` MUST be proven safe integers. A disagreement between native
run evidence, total-change evidence, the expected statement ordinal and the
legacy-source count poisons the graph.

The outer authority MUST maintain three independent monotonic dimensions:

- transaction epoch: every attempted native statement execution;
- total-changes watermark: SQLite's observed permanent-write counter; and
- permanent-write ledger: logical write sequence, fixed statement count and
  affected-row watermark.

The ledger before/after/delta values MUST be recorded explicitly rather than
left only as arithmetic that downstream code could recompute differently. On a
successful 0002 execution, logical write sequence advances by one, fixed
statement count advances by twenty, affected rows advance by `1 + L`, and
transaction epoch advances by twenty. The authority's synchronized progress
MUST be updated after every statement so a partial failure cannot be mistaken
for a pristine retry point.

The authority write-phase state machine MUST distinguish at least
`ready-0002`, `executing-0002`, `0002-complete`, `poisoned` and `retired`.
The sole execution entry point accepts only the active exact outer authority.
Calling it twice, invoking it through a forged authority, observing unexpected
catalog/source metadata, detecting TEMP conflicts, receiving a statement
failure or encountering an accounting mismatch MUST fail closed. A second
execution attempt after success MUST not emit new SQL and MUST poison the
authority, because migration 0002 is a single-use authority transition rather
than an idempotent public utility.

The authentic `migration0002CatalogRebuildReceipt` MUST be a frozen,
null-prototype, weak-identity-backed capability. At minimum it binds:

- the exact outer authority predecessor and exact connection;
- transaction lineage and transaction epoch;
- pre/post `total_changes()` values and exact delta;
- explicit three-dimensional ledger before, after and delta snapshots;
- the exact SQL asset proof, SHA-256 and byte count;
- the exact preview-manifest proof identity and digest;
- the target schema SQL digest;
- pre-DDL and post-DDL catalog digests;
- source and target application/user versions;
- schema-row and legacy-operation source counts;
- all twenty per-statement affected-row deltas;
- canonical parameter digest `8acdfd6d6db0a16086d0bb5d07e6d316e1d6a9f5ef819c6caac2d39cd61b80a`;
- canonical result digest for `{affectedRows:"1+L"}`; and
- the exact successful authority phase and logical migration count.

Receipt reading is not merely an object lookup. Every read MUST freshly
revalidate that the authority is still active, owns the same connection and
lineage, has not fallen behind any receipt watermark, and still retains the
same asset/manifest identities. Rollback, close, poison, transaction restart or
connection replacement MUST invalidate the old success receipt. A copied,
serialized, reconstructed, proxy-wrapped or prototype-similar value MUST never
be accepted as authentic.

The success-path evidence matrix MUST cover both boundary shapes:

- `L = 0`: statement 4 contributes one row, statement 17 contributes zero,
  aggregate delta one, and the exact twenty-entry vector is asserted;
- `L = 2`: statement 4 contributes one row, statement 17 contributes two,
  aggregate delta three, both operations survive with canonical payloads, and
  the exact twenty-entry vector is asserted.

Additional hostile evidence MUST include exact asset/manifest proof, byte-copy
parity, forged receipt rejection, second-execution poisoning with zero extra
SQL, rollback restoring the exact pre-DDL catalog, stale receipt rejection
after rollback, public prepare replacement resistance and upstream native
prepare failure containment. The next hostile-campaign tranche MUST add a
production-safe deterministic probe for failure after statement 10, per-name
TEMP shadow attempts, broader native/prototype poisoning and repeated partial
failure scheduling. That probe MUST NOT be implemented as a public arbitrary
fault callback or caller-controlled SQL seam.

Release automation MUST verify the preview closure without changing active
release claims. Source checks compare spec/npm/Python bytes and compiled trust
anchors. npm pack/install checks verify that both preview assets survive the
published package boundary. Python wheel/sdist/install checks verify that both
mirrors survive every Python artifact boundary. Release reports separately
state active asset counts and preview asset counts so a green v1 release check
cannot conceal missing v2 preview material.

The tranche acceptance gate is all of the following, with uncontended runs
used for timing-sensitive evidence:

1. focused outer-authority, migration and target-catalog tests pass;
2. the complete SQLite package test suite passes;
3. SQLite and workspace typecheck pass;
4. workspace lint and diff hygiene pass;
5. source-only migration release verification passes;
6. release-checker self-tests, including preview drift rejection, pass;
7. Python release-script lint and artifact verification pass;
8. B3 conformance remains green while retaining
   `implementationClaim: false` and `activeManifestClaim: false`;
9. independent static audits report no unresolved high or medium defect in the
   implemented scope; and
10. a durable review log records commands, findings, remediations and honest
    nonclaims.

Passing this gate authorizes only the next dependency-DAG leaf: a post-DDL
catalog fence that performs a fresh connection-owned observation and binds the
authentic 0002 receipt, authority, lineage, epoch, total-change watermark and
three-dimensional ledger. The fence MUST not trust the receipt's stored target
snapshot as a substitute for a fresh read. It MUST retire or poison on drift
and remain unusable after rollback/restart.

The following remain explicit nonclaims after this tranche: Python-native 0002
execution, public activation of manifest v2, reader lease/terminal proof,
baseline entries/header/sequence receipts, cursor-state migration, four-receipt
adoption, cursor rebind, validation rules 11/12, TEMP retirement and outer
commit. Python execution is a separate parity leaf: it must reproduce exact
statement order, source counts, counter evidence, rollback semantics and
artifact identities in the Python provider rather than merely copying assets.
No README, release note or package metadata may imply those later leaves are
complete before their own acceptance records exist.

Parallel execution plan for the next three development days:

- lane A implements and hostile-tests the fresh post-DDL catalog fence;
- lane B designs the non-public deterministic partial-execution harness and
  verifies the statement-10 recovery/poison model;
- lane C implements Python provider parity for packaged asset loading and exact
  sequential 0002 execution behind an internal experimental authority;
- lane D expands npm/Python artifact matrices, Windows/newline portability and
  release-report evidence;
- the primary agent owns integration, immutable-plan hashing, full-suite
  serialization, audit reconciliation, commit identity and remote verification.

Every lane MUST work on a bounded leaf with explicit input/output contracts.
Parallel agents may inspect and implement independent files, but full package
tests, artifact builds and release gates are serialized to avoid false timing
failures and shared-build interference. Integration occurs only after static
diff review, targeted tests and authority-boundary review. Meaningful green
leaves are committed and pushed with `reacher-z <mtrxcop@gmail.com>` and no
co-author trailers; unrelated dirty-worktree files remain outside the commit.

#### 31.37.28.1 Append-only correction to the canonical parameter-digest line

The canonical empty-parameter digest written earlier in section 31.37.28 as
`8acdfd6d6db0a16086d0bb5d07e6d316e1d6a9f5ef819c6caac2d39cd61b80a`
contains a transcription error and is superseded by this append-only
correction. The frozen conformance fixture and production implementation define
the authoritative value as
`8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a`.
No earlier plan text was edited to apply this correction.

The result binding `{affectedRows:"1+L"}` describes the formula, not a literal
string payload. For each execution, the canonical result digest is calculated
over the decimal string of the actual safe-integer result: `"1"` when `L=0`,
`"3"` when `L=2`, and generally `String(1 + L)`. This makes receipts from
different source cardinalities cryptographically distinct while retaining the
exact formula invariant.

### 31.37.29 Fresh post-DDL physical-catalog fence implementation tranche (append-only execution plan, 2026-07-29)

This tranche consumes the authorization granted at the end of section
31.37.28 and implements only the fresh post-`0002` physical-catalog fence. It
does not modify any earlier plan line and does not widen the leaf into baseline
publication, reader leasing, adoption, cursor rebind or commit.

The production mint API accepts exactly two authority-bearing inputs: the
module-minted outer publication authority and its authentic migration-0002
catalog-rebuild receipt. Connection, catalog rows, catalog digest, inventory,
epoch, counters and ledger values are never caller parameters. The mint
function derives all of them from private exact-object registries and the
authority-owned connection.

Validation order is frozen as follows:

1. detect an already minted fence before any SQLite access and terminally
   reject a second mint;
2. reject an early mint from any phase before exact 0002 completion;
3. authenticate receipt WeakMap provenance and exact authority/connection
   identity before any live SQL, so forged or cross-run presentation cannot
   poison a healthy graph;
4. revalidate the live active outer authority and unchanged BEGIN EXCLUSIVE
   lineage;
5. require exact equality with the 0002 receipt-after transaction epoch,
   `total_changes` watermark and all three outer-ledger dimensions;
6. perform a new connection-owned physical-catalog read rather than trusting
   the catalog retained as receipt evidence;
7. validate the complete expected target projection and cross-check its digest,
   versions and sizes against the 0002 receipt; and
8. mint the opaque fence in one non-interruptible in-memory tail.

The sole catalog query remains the exact package-owned SQL using
`lower(name) GLOB 'ge_cycle_*'`, `sql IS NOT NULL`, and binary type/name order.
Its SHA-256 is
`bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c`.
The catalog proof binds exactly 34 rows, 5,785 canonical UTF-8 bytes, the full
34-entry ordered inventory, application ID 1,195,724,359, user version 2 and
catalog digest
`ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf`.
SQL text is hashed exactly as SQLite stores it. Column and constraint identity
is transitively bound by the table SQL hashes; equal-count object replacement,
case-variant owned objects and whitespace-only DDL changes cannot pass.

The resulting fence is a frozen null-prototype token authenticated by a
private WeakMap. Its snapshot binds:

- exact connection, authority and 0002 receipt object identities;
- unchanged transaction lineage and the mint-time private epoch;
- mint-time `total_changes` and three-dimensional ledger watermarks;
- exact catalog query, query hash and digest domain;
- complete ordered catalog inventory, row count and canonical byte count;
- catalog digest, application ID and user version;
- mint count one and zero receipt consumption; and
- proof scope
  `post-0002-physical-target-catalog-before-baseline-publication` with
  `isFinalV2SemanticProof: false`.

Minting changes no SQLite row, transaction epoch, `total_changes` value or
outer-ledger dimension. It does not consume the 0002 receipt and does not mint
a tombstone. It only records the fence pointer, changes the private write phase
to `post-ddl-catalog-fence`, and advances the fence mint count from zero to one.

Exact presentation is reusable inside the same live graph. Every assertion
first rejects clone, Proxy, revoked Proxy, substituted receipt, cross-run fence
or wrong authority without poisoning either valid graph. It then revalidates
the authority, receipt, lineage and non-regressing watermarks and performs a
new physical-catalog read. The mint-time fence remains compatible with later
authorized DML, so future assertions use lower-bound watermark checks; every
increment still must be explained by the authority's receipt chain.

Terminal lifecycle is monotonic. Rollback/rebegin retires the graph and later
presentation cannot turn retired into poisoned. A real invariant failure
poisons the graph and later calls cannot turn poisoned into retired. Connection
close surfaces a structured unavailable error, poisons the live authority and
leaves every subsequent presentation terminal. This requires owner snapshot
code to check the real connection-open state before reading native transaction
accessors, because closed native objects may otherwise throw unclassified
driver errors.

Catalog iterator failure precedence is also part of this leaf. Row/fetch
primary failure outranks iterator close. When row iteration itself succeeds,
the reader records a close error but defers it through metadata decoding,
canonical snapshot construction and full expected-target validation. Catalog,
metadata, digest or inventory corruption therefore outranks cleanup; only a
fully valid catalog may surface the deferred close failure. The iterator close
attempt still occurs exactly once.

Required hostile evidence includes:

- `L=2` success with ledger 1/20/3 and zero mint-side counter movement;
- exact repeated assertion with mint count remaining one;
- forged/cross-run 0002 receipt rejection followed by corrected exact mint;
- forged, cloned, Proxy, revoked Proxy and cross-run fence rejection while both
  valid graphs remain active;
- early mint poisoning and second-mint poisoning before live SQLite reads;
- old fence rejection after double-mint poison;
- rollback/rebegin followed by repeated presentation that remains retired;
- connection-close structured unavailable classification and terminal replay;
- catalog/epoch drift poisoning;
- explicit spies proving mint and assertion each invoke the independent fresh
  validated catalog reader; and
- exact query, domain, inventory, epoch, lineage and total-change snapshot
  commitments.

Acceptance requires SQLite typecheck, the combined authority/target/migration/
connection focused suite, the complete SQLite package suite, workspace
typecheck/lint, frozen B3 conformance with false implementation/active-manifest
claims, diff hygiene and three independent final static reviews at H=0/M=0.
Only after those gates may this leaf be committed and pushed.

Passing this tranche authorizes the next leaf: the independent post-DDL
publication reader lease and its terminal proof. That future lease may read
only the fixed ordered B2 TEMP-stage projection, permits at most one owned
reader, closes exactly once, binds the fence and exact projection, and must be
closed before any stage adoption. Baseline entries/header/sequence writes,
four-receipt consumption, stage adoption, publication session, cursor rebind,
rules 11/12, final audits, retirement and commit remain explicit nonclaims.

### 31.37.30 Post-DDL publication reader lease and terminal-proof tranche (append-only execution plan, 2026-07-29)

This tranche consumes only the authorization at the end of section 31.37.29.
It implements the independent package-private reader that transfers the exact
ordered B2 TEMP projection into privately retained canonical entries after the
physical target catalog has been rebuilt and fenced. It does not edit or
reinterpret any earlier plan line. It does not authorize a permanent baseline
write, receipt consumption, stage adoption, cursor rebind, TEMP retirement or
transaction commit.

The reader source is one immutable, single-line, zero-parameter statement:

`SELECT kind_rank, entry_kind, key_blob, state_blob FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC`

Its exact UTF-8 SHA-256 is
`adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f`.
The connection layer selects this statement only from the closed-set internal
kind `cursor-publication-post-ddl-baseline-source`. The outer reader recomputes
the hash before prepare. Callers cannot provide SQL, parameters, a statement,
an iterator, rows, a projection, hashes, counts or cleanup callbacks.

The sole reader authority is a frozen null-prototype opaque lease registered
in a private WeakMap. The lease is minted from exactly the live outer
publication authority, its authentic migration-0002 receipt and its exact
post-DDL physical-catalog fence. Everything else is derived from the private
authority and pre-rebind receipt graph. In particular, the lease binds the
real `SQLiteCursorExactProjectionReference` object retained by the B2 receipt;
an equal projection-identity snapshot is not a substitute for that opaque
reference.

The lease binds all of the following identities and observations:

- exact connection, outer authority, TEMP stage and stage-ownership transfer;
- exact pre-rebind receipt projection identity and opaque projection reference;
- authentic migration-0002 receipt and exact post-DDL catalog fence;
- unchanged BEGIN EXCLUSIVE transaction lineage and read-proof epoch;
- exact `total_changes` read watermark and all three outer-ledger dimensions;
- exact source SQL, source SQL digest and zero-parameter contract;
- prepare, execute, ownership-acquisition, fetch-attempt and close-attempt
  counters as distinct observations; and
- explicit negative authorities: no permanent-write power, no write-receipt
  consumption and no stage-adoption receipt minting.

Exactly five lifecycle labels exist: `minted-unused`, `reader-active`,
`reader-closed`, `retired` and `poisoned`. The observable success path is
`minted-unused -> reader-active -> reader-closed -> retired`.
`reader-closed` is a synchronous intermediate state: downstream proof
presentation accepts only `retired`, while future stage adoption additionally
requires the same exact lease identity, one close attempt and a successful
close. The lease itself is the terminal proof. No second terminal-proof token,
serialized surrogate or caller-constructible snapshot is created.

Prepare and ownership have a literal boundary. A prepare failure records no
successful prepare and no close. An iterator-acquisition failure records the
successful prepare but neither execute/ownership nor close. Ownership begins
only after captured-native `iterate()` returns a real iterator. At that instant
the implementation records execute and ownership once, enters
`reader-active`, and registers the exact idempotent close callback with both
the stage-ownership bridge and the TEMP stage's dedicated post-DDL cleanup
slot.

The new cleanup slot is independent from the already consumed B2 ordered-
handoff cleanup. Direct stage disposal, stage poison, outer-authority poison
and outer-authority retirement all encounter the new slot before TEMP cleanup.
They may invoke the same callback through different nested paths, but the
lease registry records the close attempt before native `return()` and makes
every later invocation a no-op or a replay of the retained close error. A
native iterator is therefore closed at most once and an owned iterator cannot
survive TEMP disposal.

Cancellation is deterministic. An invalid cancellation object is a
non-poisoning presentation error. A valid already-cancelled signal is checked
before prepare; the exact lease remains `minted-unused`, every reader counter
remains zero and the same lease may be retried. Cancellation observed after
ownership requires exactly one close attempt, cannot produce a terminal proof
and poisons the graph. A second mint, a reentrant second open, execution replay
after retirement and reuse after close are invariant failures that poison the
exact graph without issuing a second reader SQL statement.

Every fetched item must be an exact four-column SQLite row. Kind rank is a
safe integer in the closed 0-through-11 range; entry kind is exact text and
must match that rank; key and state are exact BLOBs within their frozen byte
limits. Rank is monotonically increasing and keys within a rank are strictly
increasing by unsigned byte comparison. Duplicate or reversed keys, an extra
column, noncanonical JSON, invalid UTF-8, a kind/rank disagreement, an extra
row or truncation is corruption.

Each row is revalidated through `validateOperationBaselineEntryBytes`, decoded
with the frozen canonical limits and appended to a fresh
`OperationBaselineAccumulator`. Re-encoded key and state bytes must equal the
SQLite BLOBs exactly. The completed accumulator must match the exact B2
baseline ID, entry count, first entry hash, final entry hash, legacy-operation
count and projection SHA-256. A successful derivation is retained for
diagnostics even when subsequent cursor close fails, but canonical row objects
are made available to the next private writer only after successful close,
unchanged post-read watermarks and final retirement.

The reader performs no DDL or DML. Before prepare and after close it reproves
the live outer authority, exact post-DDL fence, unchanged lineage, epoch,
`total_changes` and exact three-dimensional ledger. Mint, fetch, close and
terminal-proof assertion do not advance logical-write sequence, fixed-
statement count or affected-row watermark. The migration receipt and catalog
fence remain unconsumed and reusable only within the same still-live graph.

Failure precedence is literal:

1. caller presentation and exact graph provenance are resolved before SQL;
2. SQL/hash, fence, lineage and read-watermark invariants are resolved before
   prepare;
3. a row/fetch/decode/order/hash/projection primary failure outranks cleanup;
4. after an otherwise valid read, native close failure outranks cancellation;
5. cancellation after ownership outranks later TEMP or outer cleanup; and
6. nested stage/outer cleanup never replaces an already selected primary.

Close failure always records one attempted close with
`closeSucceeded = false`, makes the lease ineligible as terminal proof,
poisons the authority graph and requires rollback. A row primary plus close
failure still throws the row primary while preserving the failed-close state.
A cancellation plus close failure throws the close failure. A row primary,
close failure and cancellation together still throw the row primary.

Exact terminal-proof assertion is non-consuming and reusable before any
misuse. It requires the same lease, authority, receipt and fence objects; one
prepare, one execute, one ownership acquisition, one close attempt, successful
close, retained canonical entries, a matching rederived projection, the exact
opaque projection reference and a stage bridge in the terminal closed state.
It then freshly reproves the post-DDL catalog fence. Executing the terminal
lease again is not proof presentation: it is forbidden replay, poisons the
graph and makes subsequent proof use inadmissible.

Focused hostile evidence must cover at least:

- successful reads with zero and nonzero legacy-operation counts;
- exact SQL text, SHA-256, closed-set read kind and one prepare;
- frozen null-prototype lease identity and authentic projection reference;
- clone, structural snapshot, Proxy, revoked Proxy, substitution and cross-run
  rejection without poisoning either untouched valid graph;
- preownership cancellation followed by successful retry of the same lease;
- prepare failure and iterator-acquisition failure with zero close attempts;
- truncation/projection mismatch after ownership with one successful close;
- row primary plus close failure, close-only failure, cancellation after
  ownership, cancellation plus close failure and all-three precedence;
- reentrant second open, second mint and replay after retirement poisoning;
- terminal assertion before ownership, during ownership, after success and
  after rollback/rebegin;
- direct stage disposal during fetch with exactly one native close;
- captured-native operation after hostile `StatementSync.prototype.iterate`
  replacement; and
- package-root negative-export checks for every reader capability and
  intrinsic.

The acceptance gate for this tranche is the reader-focused suite, combined
reader/outer-authority/connection suite, complete SQLite package suite,
workspace typecheck and lint, B3 schema/fixture/validator gates with
`implementationClaim: false` and `activeManifestClaim: false`, source and
package release-asset checks, `git diff --check`, append-only plan prefix
verification and independent severity-zero static reviews. A durable review
log records the exact commands and honest remaining nonclaims before commit.

Passing this tranche authorizes exactly the baseline-entry publication receipt
leaf. That successor must consume the private canonical entries from this
exact terminal lease without another TEMP SELECT, execute the fixed one-
prepare/E-run baseline-entry INSERT, advance the outer ledger from logical
write one to two and mint one authentic non-consumed receipt. Baseline header,
sequence zero, four-receipt atomic adoption, Python parity, the executable
145-case hostile campaign, publication session, cursor rebind, validation
rules 11/12, TEMP retirement, commit, manifest activation and release claims
remain downstream work.

#### 31.37.31 Baseline-entry permanent publication receipt implementation tranche

This append-only tranche implements the direct successor authorized by section
31.37.30 and stops before baseline-header publication. It converts the exact
terminal reader lease into the second ordered initial-write receipt while
preserving the caller-owned `BEGIN EXCLUSIVE` transaction, package-private
authority graph and false release/manifest claims.

The only permitted permanent statement is the following exact 183-byte UTF-8
literal:

```sql
INSERT INTO main.ge_cycle_operation_baseline_entries (baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
```

Its SHA-256 is
`b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b`.
The connection owns this SQL through a closed-set intrinsic. Caller SQL,
subclass `prepare`, mutable native prototypes, `RETURNING`, transaction-control
statements, savepoints and implicit transaction replacement are forbidden.

The connection mints one opaque execution object only under the live exclusive
transaction lineage. It captures the exact connection and lineage identities,
private epoch, initial and current `total_changes`, expected entry count `E`,
one native statement, run-attempt count, native-run-completed count, next
ordinal, actual affected-row delta and lifecycle `active`, `completed` or
`poisoned`.

The prepare happens once before any row execution. An empty `E = 0` projection
still performs that prepare and completes without a run. Nonempty execution
accepts exactly `E` calls in strict zero-based ordinal order. A terminal or
replayed execution object is corruption and can neither prepare nor run again.

Every run receives exactly seven parameters in this order:

1. baseline ID as text;
2. ordinal as a canonical non-negative integer;
3. entry kind as text;
4. entry-key bytes as BLOB;
5. entry-state bytes as BLOB;
6. previous-entry hash as lowercase hexadecimal text; and
7. entry hash as lowercase hexadecimal text.

Parameter validation reads only own data properties, rejects Proxy and revoked
Proxy carriers, rejects missing/accessor properties and constructs the tuple
internally. String code-unit, prefix and slice operations use module-load-
captured native intrinsics through `Reflect.apply`. Database prepare, statement
run and SHA-256 update/digest are likewise probed and captured at module load;
later hostile prototype replacement cannot alter validation, SQL identity or
receipt proof, and cannot escape as an unstructured error.

The irreversible progress boundary is native `run` return. The execution
records the completed row and advances the epoch before inspecting the result
or a later counter. Each result must expose one own `changes` data property
equal to integer one, and real `total_changes` must advance by exactly one.
Result-shape, affected-count or counter disagreement poisons the execution
while retaining the real completed-row, execute-attempt, epoch, affected-row
and counter observations. Cleanup failure cannot replace the primary error.

The outer writer accepts exactly the active authority, its exact migration
`0002` receipt, exact reusable post-DDL catalog fence and exact retired reader
lease with one successful close. Clone, structural copy, Proxy, wrong-run or
substituted predecessors fail identity validation. A wrong graph writes
nothing and leaves an untouched valid graph retryable. Replay after a receipt
exists poisons before prepare or row execution.

Before prepare, the writer freshly asserts the terminal reader proof and
catalog fence. It requires reader lifecycle `retired`, prepare one, execute
one, ownership one, close attempt one, close success, private retained entries,
exact projection reference and independently rederived projection. It consumes
only those private rows: no second `temp.ge_blr_stage` query, caller row array,
caller baseline ID, caller count, caller ordinal or caller hash is allowed.

The retained vector is traversed in exact ordinal order and reproves vector
length, baseline ID, ordinal, genesis predecessor, continuous previous/entry
hash chain, first hash, final hash and projection terminus. The literal phase
transition is:

`post-ddl-reader-closed -> executing-baseline-entries -> baseline-entries-complete`.

Any predecessor, SQL, chain, prepare, run, result, counter, ledger, digest or
receipt-construction invariant failure poisons the graph. Only complete receipt
mint reaches `baseline-entries-complete`; partial success never advances the
logical-write sequence to two.

The writer constructs one dense two-dimensional parameter frame. Its outer
dimension has exactly `E` executions and every inner dimension has exactly
seven tagged scalars. BLOBs use unpadded base64url, ordinals use canonical
decimal and Unicode is not normalized. Flattening executions, adapter
serialization, caller digests or per-row digest substitution is forbidden.
The aggregate result payload is exactly `{"affectedRows":"E"}` and excludes
`lastInsertRowid`.

Receipt mint performs an independent verification pass after all rows have
been written but before any receipt enters its registry. The verifier rebuilds
the full frame from the private lease, recomputes parameter and result digests
through captured intrinsics and compares both first-pass outputs. A fault that
changes either digest leaves completed rows and real progress visible, mints
zero receipts, poisons the authority and requires rollback. Complete DML is not
equivalent to an authentic receipt.

The frozen null-prototype receipt explicitly commits:

- write kind `baseline-entries-publication`;
- exact authority, connection and transaction-lineage identities;
- before/after private epochs and `total_changes`;
- exact migration receipt, catalog fence and terminal reader lease;
- reader lifecycle `retired`, close count one and rederived projection digest;
- exact projection and opaque projection-reference identities;
- baseline ID, entry count, first hash and final hash;
- ordered source-read SQL and SHA-256;
- fixed INSERT SQL and SHA-256;
- canonical two-dimensional parameter and aggregate result SHA-256 values;
- prepare one, execute `E` and affected rows `E`;
- three-dimensional ledger before, after and delta; and
- mint count one.

Receipt assertion is reusable and non-consuming. It rechecks the exact graph,
terminal reader, live authority, fixed SQL hashes, source-read identity,
retained frame, result, baseline chain, counters and ledger predecessor. Later
authorized ledger advancement is permitted, but regression below the receipt
watermarks is forbidden. Caller construction, cloning and cross-run reuse
cannot enter the registry.

The successful outer ledger transition is:

- logical writes: `1 -> 2`, delta one;
- fixed statements: `20 -> 20 + E`, delta `E`; and
- affected rows: `1 + L -> 1 + L + E`, delta `E`.

For frozen `E = 12`, `L = 1`, this is `1/20/2 -> 2/32/14`. A failure after six
completed rows retains `1/26/8`, execute six, affected six, mint zero and
poisoned state. Prepare failure retains `1/20/(1 + L)` with zero execution and
mint. A post-write digest fault retains complete physical progress but logical
sequence one and mint zero.

The hostile suite covers exact SQL/SHA, one-prepare/E-run behavior, a real
12-by-7 parameter frame, chain continuity, result known answer, no second TEMP
read, prepare failure, six-row partial failure, wrong `changes`, digest faults,
hostile database/statement/string/hash prototypes, transaction ownership,
receipt identity/assertion, clone/Proxy/wrong graph, active or failed-close
reader, stale lineage, unexplained watermark drift, replay before additional
SQL and package-root negative exports.

Acceptance requires the focused receipt suite, combined reader/authority/
connection suite, typecheck/lint, complete SQLite regression, B3 fixture and
validator gates, migration/package gates, `git diff --check`, append-only
prefix verification and independent severity-zero review. Exact evidence is
recorded in the durable review log after the final regression.

Passing this tranche authorizes only baseline-header publication. Sequence
zero, four-receipt adoption, Python parity, full hostile registry, publication
session, cursor rebind, rules 11/12, TEMP retirement, commit, manifest switch,
release claims and any GitHub-star/adoption outcome remain downstream and
unclaimed.

#### 31.37.32 Baseline-entry publication executable acceptance checkpoint

The implementation tranche in section 31.37.31 has passed its bounded
acceptance gates. It is now the second authentic initial-write leaf after the
exact migration `0002` receipt and does not broaden the active-manifest or
protocol-completion claims.

Final executable evidence is:

- baseline-entry hostile suite: 20/20;
- final baseline-entry/reader/outer-authority/connection serial integration:
  104/104;
- final SQLite package regression: 28/28 files and 962/962 tests;
- workspace typecheck and lint: all eight implementation packages;
- ledger/B3 contract tests: 61/61 plus strict validators;
- B3 frozen hostile registry: 145/145 records, with implementation and active-
  manifest claims still false;
- migration release checks: source/mirror digests plus 6/6 executable tests;
- npm package content checks: eight/eight packages;
- packed-install smoke: eight/eight tarballs and healthy installed binaries;
- append-only plan proof: the original first 14,695 lines still hash to
  `e54ea6e2fe71555fbf089fbec1df0c15143a3e29fcd9e78df0b07f86d58ce27c`;
  and
- independent final static review: HIGH 0 / MEDIUM 0 / LOW 0.

The hostile suite discovered and closed two post-implementation defects rather
than merely confirming the happy path. First, a complete 12-row DML pass could
receive a faulted parameter/result digest before receipt registration; receipt
mint now performs an independent private-row verification pass and mints zero
on disagreement while retaining real completed progress. Second, mutable
string and hash prototypes could escape structured error handling; the
connection and outer authority now capture, probe and invoke those native
intrinsics through `Reflect.apply`. The final hostile hash case proves zero
calls reach replaced prototype methods during publication or receipt assertion.

This checkpoint authorizes implementation of the baseline-header publication
receipt with this exact entries receipt as predecessor. It does not authorize
sequence zero, receipt consumption, stage adoption, Python parity, cursor
publication, transaction commit, manifest activation, release-candidate status
or claims about external adoption and star counts.

#### 31.37.33 Baseline-header permanent publication receipt tranche

This tranche implements the third ordered initial-write receipt and stops
before operation-sequence zero. Its only predecessor is the exact authentic
baseline-entry publication receipt from section 31.37.32; an entries clone,
structural copy, Proxy, revoked Proxy, cross-run receipt or receipt from another
authority/fence/reader graph cannot authorize the header.

The fixed INSERT is the literal B3 contract SQL for
`main.ge_cycle_operation_baselines`, with SHA-256
`b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a`.
The statement fixes baseline format version one, source application ID
1195724359 and source user version one in SQL. It binds exactly fourteen
parameters in the frozen order: baseline ID, source schema hash, source
migration-lineage ID/hash, source descriptor hash, capture time, legacy count,
entry count, first hash, final hash, projection hash, creation runtime,
creation runtime version and policy BLOB.

The connection provides one closed-set, opaque, exclusive-lineage execution
session. It prepares once, runs once, requires own-data parameter properties,
rejects Proxy carriers, verifies one affected row and one real
`total_changes` delta, records native-return completion before result
inspection, preserves actual progress after failure and poisons replay. It
never issues transaction control and never accepts caller SQL.

Every header value is derived inside the authority graph:

- source fields and `capturedAtMs` come from the exact frozen source envelope
  retained privately when the outer authority validates its A2b receipt;
- baseline, counts and first/final/projection hashes come from the exact
  projection and entries predecessor;
- creation runtime is the literal `graph-engineering-typescript`;
- creation runtime version is the literal `0.1.0-alpha.1`; and
- policy bytes come from `encodeOperationBaselinePolicy()` and are detached
  before the native write.

Caller runtime identity, `process.version`, package-manager environment,
ambient interpreter version, caller policy, caller clock and reconstructed
source envelopes are forbidden. The authority retains the already validated
source envelope privately rather than re-entering a mutable provenance hash
path during header publication.

The canonical parameter digest is a dense one-execution by fourteen-scalar
frame. The policy BLOB is committed by byte length, base64url bytes and SHA-256.
Parameter and aggregate `{"affectedRows":"1"}` result digests are independently
recomputed before receipt registration. A complete native write followed by a
digest fault retains the real fixed-statement/affected-row watermarks, mints
zero receipts and poisons the authority.

The phase transition is literal:

`baseline-entries-complete -> executing-baseline-header -> baseline-header-complete`.

The successful three-dimensional ledger delta is `+1/+1/+1`: logical sequence
two to three, fixed statements `20 + E` to `21 + E`, and affected rows
`1 + L + E` to `2 + L + E`. Prepare failure records zero run/affected progress;
native-return or result-shape failure records the real one-row progress without
minting a receipt. A second header call poisons before additional SQL.

The frozen null-prototype receipt commits the authentic entries predecessor,
authority, connection, lineage, catalog fence, reader lease, projection
reference, all source/projection/header scalars, exact SQL/hash/parameter order,
policy byte identity, parameter/result digests, before/after epochs and
`total_changes`, counters and the complete outer-ledger transition. Assertion
is reusable and non-consuming for sequence-zero and adoption work.

All new database, statement, string, buffer and SHA-256 operations use module-
load-captured intrinsics. SQL preflight, parameter construction, predecessor
observation, native execution, receipt verification and assertion translate
ordinary failures into structured provider errors before poisoning; no raw
hostile-prototype error may leave the authority active or ambiguously retryable.

The dedicated hostile suite covers exact SQL/SHA and fourteen-order, strict
one-by-fourteen typed framing, stable runtime literals, the canonical 946-byte
policy BLOB and fixed policy hash, source/projection/hash commitments, one
prepare/run/change/counter delta, ledger transition, cloned/proxied/revoked/
cross-run predecessors, replay, prepare/run/result/digest failures, no
transaction ownership, stale lineage, catalog and watermark drift, captured
native/string/hash methods and package-root negative exports.

Acceptance requires the 19-case header suite, entries regression, complete
SQLite package regression, workspace typecheck/lint, B3 and migration gates,
package/install smoke, append-only prefix proof and final severity-zero review.
Passing authorizes only the sequence-zero receipt. Receipt consumption, atomic
stage adoption, Python parity, cursor rebind, rules 11/12, TEMP retirement,
commit, active manifest and release/adoption claims remain downstream.

#### 31.37.34 Baseline-header executable acceptance checkpoint

The header tranche has passed its bounded executable gates: header hostile
tests 19/19, entries-plus-header focused regression 39/39, SQLite full
regression 29/29 files and 981/981 tests, workspace typecheck/lint across all
eight implementation packages, B3/ledger contracts 61/61 plus validators,
migration release tests 6/6, eight/eight npm package-content checks and
eight/eight packed-install smoke tests.

The pre-append 14,892-line plan prefix remains byte-identical with SHA-256
`5c34ede9379797e0b1b9b70672fb7014c9b8b0ccd5dcb93aab37fc26580a88cf`.
Independent final review is HIGH 0 / MEDIUM 0 / LOW 0 after explicitly closing
owner/counter observation termination and exact single-run epoch `+1n` proof.

This milestone is the third non-consumed receipt in the initial publication
chain. The next implementation leaf is operation-sequence-zero publication
using the exact header receipt and provider-authoritative outer timestamp.
Protocol completion, adoption, rebind, commit, manifest and release claims
remain false.

## 31.38 D6 integrated-barrier, quorum, deadline and durable decision-replay contract freeze (append-only execution plan, 2026-07-30)

This section is append-only. It does not edit, delete, weaken, reinterpret or
mark complete any earlier line. The pre-append 14,999-line prefix remains
byte-identical with SHA-256
`99c9abbf7e332f2a5b0cac39887f9a46662dea4ad41c10760c25d8e8256c508f`.

### 31.38.1 Why this tranche exists and what it is not

Section 31.35.12 accepted the integrated-router compiler, `routedBranches`
lowering, ordinary execution and the zero-execution foreign-condition preflight,
and closed with an explicit exclusion list: no dedicated durable `RouteSelected`
identity, no zero-rejudge decision replay, no integrated all/minimum/percentage
barriers, no quorum, no abstention, no deadlines, no late-arrival policy, no
barrier cancellation propagation, no barrier trace or CLI visibility and no
distributed coordination. `D6-ROUTER-BARRIER-023` therefore remained open.

This tranche freezes exactly that excluded remainder as a contract candidate. It
implements nothing. `implementationClaim` is `false` for the barrier contract
and stays `false` until executable dual-language evidence exists.

### 31.38.2 The safety fact that motivates the first deliverable

`packages/runtime/src/scheduler.ts` currently classifies a `barrier` node
together with `transform` and executes it as an ordinary deterministic node.
`packages/primitives/src/barrier.ts` provides only a pure settled evaluator over
`all`, `minimum` and `percentage`, with no quorum, deadline, abstention,
scheduler integration or durable decision.

The consequence is not a missing feature but a wrong answer: a graph that
declares a barrier policy today is executed as a plain transform, which silently
passes a barrier whose policy was never evaluated. Therefore the first
deliverable of this lane, ahead of any barrier functionality, is a
pre-dispatch capability rejection in both runtimes for a `barrier` node bearing
an exact `IntegratedBarrierPolicy`, with zero executor calls, zero node
attempts and no durable side effect. This reuses the accepted foreign-condition
preflight mechanism rather than inventing a second gate.

### 31.38.3 Frozen contract artifacts

The normative source is `spec/integrated-barrier-semantics.md`. Its
machine-readable carriers are `spec/integrated-barrier-policy.schema.json`,
`spec/barrier-vote.schema.json`, `spec/barrier-decision.schema.json` and
`spec/route-decision.schema.json`. The literal shared corpus is
`spec/conformance/integrated-barrier.case.json` with an independently
recomputing validator at `spec/conformance/integrated-barrier.validate.mjs`.
The construction brief is
`codex_plans/delivery/d6-integrated-barrier-implementation-brief.md`.

The contract freezes the direct barrier policy on `barrier` nodes, a closed
six-member arrival-disposition vocabulary including `abstained` and `unknown`,
the `BarrierVote` carrier and retained-vote requirement for quorum, exact-integer
satisfaction arithmetic for all four kinds, deterministic deadline arming and
settlement against an injected clock, the closed `onUnsatisfied` resolution set,
late-arrival behavior, cancellation propagation, the frozen `BarrierSatisfied`
and `RouteSelected` decision documents with domain-separated identities, and
compiler diagnostics `GE1421` through `GE1424`.

### 31.38.4 Non-negotiable semantic decisions

1. `onUnsatisfied` and `lateArrival` are required for every policy kind and have
   no default, because a silently defaulted unsatisfied barrier is exactly the
   implicit pass this contract exists to forbid.
2. An unsatisfied barrier never succeeds and never binds an output. All three
   resolutions — `fail`, `unknown` and `awaiting_human` — are non-passes.
3. A quorum `unknown` vote always counts as a participant and never as an
   accept. A malformed vote is the non-retryable `INVALID_BARRIER_VOTE` after
   exactly one attempt and is never coerced to `abstain` or `unknown`.
4. Percentage and quorum arithmetic is exact safe-integer multiplication. No
   floating-point ratio is computed in either language.
5. Deadlines are evaluated only against an injected monotonic clock at
   scheduler quiescence points. No wall clock and no timer participates, so a
   scripted tick list produces identical results in both languages.
6. A committed decision is authoritative forever. Resume, replay and fork adopt
   it verbatim with zero executor calls, zero re-evaluation and no second
   decision event. `policyHash` drift, `decisionId` mismatch and a duplicate
   decision are three distinct non-retryable failures rather than a silent
   re-judgement.
7. Run terminal precedence becomes `failed`, `cancelled`, `awaiting_human`,
   `unknown`, `succeeded`. `UPSTREAM_UNKNOWN` is excluded from graph failure
   codes exactly as `ROUTE_NOT_SELECTED` already is.
8. `awaiting_human` suspends the run and stops. The authority that may later
   resume it is `D9-APPROVAL-077` work and is an explicit non-claim here.

### 31.38.5 Execution order

P0-A freezes the semantics and schemas. P0-B produces the literal corpus and a
validator that independently recomputes every stored hash and every arithmetic
expectation, so a corpus typo fails the gate. P0-C runs the TypeScript and
Python lanes in parallel on disjoint paths, each delivering the capability gate
first, then the compiler pass, then scheduler integration. P0-D adds the
cross-language join under `tools/conformance/` in which neither side imports the
other's expected values. P0-E adds documentation, a provider-free example, an
independent hostile review by a reviewer who did not author the candidate,
registry evidence and the coverage-matrix update.

Ordering violations discovered in 31.35.12 must not recur: diagnostic emission
order must be identical in both languages, and the package root must export the
discriminated result union members alongside the validator functions.

### 31.38.6 Explicit non-claims

This tranche claims no barrier capability, no quorum capability, no deadline
capability, no decision-replay capability, no human-approval authority, no
verifier or judge semantics, no budget accounting, no distributed coordination,
no Explorer or CLI barrier visibility, and no release, adoption or star outcome.
Freezing a contract is not implementing it. Until the P0-C and P0-D evidence
exists, the Day 6 coverage-matrix row remains Partial and
`D6-ROUTER-BARRIER-023` remains in progress.

#### 31.37.35 Operation-sequence-zero permanent publication receipt tranche (append-only execution record, 2026-07-30)

This section belongs to the §31.37 initial-publication chain and consumes only
the authorization at the end of §31.37.34. It is appended here, after §31.38,
because this plan is append-only and no earlier line may be edited or displaced.
The pre-append 15,109-line prefix remains byte-identical with SHA-256
`fde874b690f0848553127750fee45f8fbcaa323b5f784d9711577a7ac008aff0`.

It implements the fourth and final ordered initial-write receipt and stops
before four-receipt atomic adoption.

### 31.37.35.1 Scope and predecessor

The sole predecessor is the authentic exact baseline-header publication receipt
minted by §31.37.33. Presentation of a clone, structural copy, Proxy, revoked
Proxy, cross-run receipt or foreign-authority receipt is rejected before any
prepare, without consuming the issuer and without disturbing the healthy graph.

The write is one `INSERT` of the singleton `main.ge_cycle_operation_sequence`
row from the frozen zero-caller-input statement

```sql
INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, updated_at_ms) VALUES (1, ?, 0, ?, ?)
```

whose exact UTF-8 SHA-256 is
`a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85`
and whose parameter order is frozen as
`baselineId`, `baselineCapturedAtMs`, `updatedAtMs`. Both values are already
frozen in `spec/conformance/sqlite-cursor-publication-rebind-v2.case.json`
together with `requiredLastCommitSequence: 0`. The reader recomputes the digest
before prepare; `last_commit_sequence` is a literal `0` inside the SQL and is
never a caller parameter.

### 31.37.35.2 Value provenance

`baseline_id` and `baseline_captured_at_ms` come from the retained A2b source
envelope and the exact projection, not from caller input. `updated_at_ms` comes
from the provider clock reading captured at outer-authority preparation from the
authentic clock evidence. It is never `Date.now()`, never an environment
variable and never a caller parameter, and the leaf must prove both that
`Date.now` is not called and that an injected environment override is ignored.

Provider-timestamp monotonicity is the defining new invariant of this leaf:
`updatedAtMs` must be greater than or equal to `baselineCapturedAtMs`. It is a
distinct branch with its own message and its own hostile case, separate from the
entry-phase conditions and from the header-snapshot identity binding. Collapsing
these into one branch is a defect, because an operator debugging a poisoned
graph would be told the clock drifted when the real cause was an out-of-order
call.

The assert path must re-derive the timestamp from the authentic clock evidence
rather than comparing a cached authority field to itself. The frozen contract
requires both the `outer-clock-evidence-receipt-object-identity` and the
`outer-provider-now-ms` commitments; proving only object identity leaves the
value binding unverified.

### 31.37.35.3 Write accounting

The phase transition is exactly
`baseline-header-complete` -> `executing-sequence-zero` ->
`sequence-zero-complete`. The outer ledger advances by exactly `+1` in each of
its three dimensions: logical write sequence three to four, fixed statement
count `21+E` to `22+E`, and affected rows `2+L+E` to `3+L+E`. This matches the
frozen counter profile `initial-sequence-complete-before-adoption` at
`outerLedgerLogicalWriteSequence: 4`.

The connection provides one opaque, WeakMap-authenticated, exclusive-lineage,
one-prepare and one-run session that verifies exactly one affected row against a
real `total_changes` delta, records native-return completion before inspecting
the result, preserves actual progress after failure and poisons replay. Prepare
failure records zero run and zero row progress; a post-write failure records the
real one-row progress and mints zero receipts. The leaf never opens, commits or
rolls back the caller transaction.

### 31.37.35.4 Failure precedence

Caller presentation and graph provenance resolve before SQL. SQL digest, entry
phase, header identity and provider-timestamp invariants resolve before prepare;
the digest comparison is performed outside the preflight `try` so that the
stage-ownership poison reason names the real defect instead of degrading to a
generic preflight failure. Post-write parameter-digest and aggregate-result
digest drift are rejected before any receipt is minted.

### 31.37.35.5 Explicit non-claims

This leaf consumes no receipt, performs no four-receipt atomic stage adoption,
opens no publication session, does not rebind the cursor, implements neither
validation rule 11 nor 12, does not retire the TEMP stage, does not commit or
reopen the transaction, activates no manifest and adds no Python parity.
`implementationClaim` and `activeManifestClaim` remain `false`. Protocol
completion, adoption, release-candidate status and any external-adoption claim
remain false.

The next implementation leaf is the four-receipt atomic stage adoption using all
four authentic non-consumed initial-write receipts.

## 31.39 D6 integrated-barrier contract revision 2: ownership is a versioned claim (append-only, 2026-07-30)

This section is append-only and edits no earlier line. The pre-append
15,206-line prefix remains byte-identical with SHA-256
`a0213ddf565b21bacd4e13f6cd0ab08a463df8c8f11fcb7bd5f1d91c7dc1fd6e`.

### 31.39.1 What revision 1 got wrong

§31.38 froze the integrated-barrier contract with an ownership rule copied
verbatim from the accepted integrated-router pass: `GE1421` owns every portable
barrier config admitted by the Graph envelope.

That copy was invalid because the two node kinds have different histories.
Routers were introduced together with their policy, so no router config predated
the rule. Barrier nodes predate this contract and already ship with configs the
rule cannot accept — `{"condition": "all"}` in
`spec/conformance/diamond.graph.json`, `{}` in the integrated-router runtime
graphs, and `{"condition": "minimum", "minimum": 1}` in
`spec/conformance/runtime-capability.case.json`, whose frozen expectation is a
successful run.

Under revision 1 every one of those became a compile error. Measured with the
pass installed: 16 pre-existing tests failed across `core/compiler`,
`core/integrated-router`, `runtime/scheduler`, `runtime/durable`,
`runtime/graph-patch` and `runtime/integrated-router-conformance`. That directly
contradicted conformance requirement 13 of the same contract, which requires the
existing core, primitives, patterns, scheduler, router and durable suites to
remain green. The two requirements were mutually unsatisfiable.

### 31.39.2 How it was found

Not by review. The TypeScript and Python implementation lanes were dispatched in
parallel with no shared channel, and both reached the identical conclusion,
implemented their compiler pass fully, and then deliberately declined to install
it — each leaving a comment at the exact insertion point recording why. Neither
invented a carve-out.

That is the outcome the ownership discipline is for. A lane that had "fixed" the
fixtures instead would have migrated `diamond.graph.json` and every dependent
frozen hash across `expected.json`, three GraphPatch corpora, the CLI, the MCP
server, both quickstarts and the Python suite — a large cross-language migration
performed to satisfy a rule that was itself wrong.

### 31.39.3 The revision

`IntegratedBarrierPolicy` now requires
`apiVersion: "graphengineering.reacher-z.github.io/barrier/v1alpha1"`. A barrier
config is a *claimed policy* if and only if it is a portable object carrying
that exact value.

Ownership is keyed on `apiVersion` alone. `kind` is validated content, not part
of the ownership key. This is a deliberate asymmetry with the conditional-edge
registry, which keys on the exact `(apiVersion, kind)` pair: keying a barrier
policy on the pair would make `{apiVersion: <exact>, kynd: "all", …}` unclaimed
and therefore silent, which is precisely the implicit pass the contract exists
to forbid.

All four diagnostics are ownership-gated, including `GE1423`. An input-free
legacy barrier keeps its pre-contract behavior; existing reachability and
entrypoint diagnostics continue to apply to it unchanged. Two `GE1421` locations
became unreachable by construction — the config root and `/apiVersion` — because
a claimed policy is by definition an object carrying the exact version.

The safety property is unchanged. The silent-pass defect concerns barriers that
*declare* a threshold, and a declaration is now something an author states
rather than something a compiler guesses. A vote-shaped object pasted into a
barrier config carries the same `apiVersion` and is therefore diagnosed rather
than silently ignored.

### 31.39.4 Corpus consequences

Every barrier `policyHash` moved, because the hash frames the canonical policy,
and every `decisionId` framing a document containing one moved with it. Exactly
the router-side literals did not move — the four `RouteDecision` identity cases,
the three route replay events and the `RouteDecision` identifier base — which is
the expected signature of a barrier-only discriminator and was used as a
correctness check rather than assumed.

The corpus grew to 79 policy cases with a three-way outcome, because "not an
exact policy" and "not claimed at all" are different facts with different
consequences; 16 compiler cases carrying 21 diagnostics, including two that mix
a legacy barrier with a claimed one in the same graph; and a new 15-case
`ownershipCases` section that drops each unclaimed config into a real conforming
graph and asserts the barrier pass emits nothing. The validator additionally
asserts that no `GE142x` diagnostic anywhere in the corpus ever names an
unclaimed barrier.

One question is deliberately left undecided in the corpus rather than guessed:
no case places an unclaimed barrier with zero incoming edges, and the validator
fails if one is ever added, so the corpus freezes no assumption about a
situation the contract had not yet settled. §31.39.3 settles it.

### 31.39.5 Non-claims

Revision 2 changes ownership only. It implements nothing, and
`implementationClaim`, `typescriptRuntimeClaim`, `pythonRuntimeClaim` and
`capabilityGateClaim` all remain `false`. No barrier execution, deadline,
quorum, resolution, late-arrival, cancellation or decision-replay behavior
exists in either runtime.
