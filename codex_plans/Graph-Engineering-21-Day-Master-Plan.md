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
