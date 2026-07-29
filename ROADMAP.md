# Roadmap

Graph Engineering is building one vendor-neutral graph contract with native
TypeScript and Python runtimes. Dates are targets, while capability claims are
earned by executable cross-language tests.

## Alpha 1 — contracts and local execution

- [x] Versioned Graph IR, canonical hashes, and stable compiler diagnostics.
- [x] Ready-queue DAG scheduling without implicit layer barriers.
- [x] Bounded concurrency, retries, timeouts, attempt budgets, and branch failure
  isolation.
- [x] Local event/checkpoint adapters with CAS, corruption detection, atomic
  replacement, and a shared hash vector.
- [x] Validate, plan, compile, doctor, machine JSON, and read-only MCP surfaces.
- [x] Safe `graph init` and the first executable pattern pack.
- [x] Scheduler JSON-output and lifecycle-cancellation parity.

## Alpha 2 — durable graph patterns

- [x] Scheduler event emission with commit-before-release node outcomes and
  tagged Durable JSON payloads.
- [x] Event-sourced crash continuation that reuses committed successes, preserves
  attempt budgets, and fails closed for ambiguous unsafe effects.
- [ ] Scheduler checkpoint acceleration; correctness already rebuilds from the
  authoritative event history.
- [x] Standalone bounded-cycle controller replay/fork in both runtimes, including
  read-only replay, multi-generation fork, and bounded content-addressed lineage
  export for offline inspection.
- [ ] Integrate replay/fork into the ordinary durable scheduler and production
  controller/store boundary. The standalone controller does not establish
  scheduler replay/fork or checkpoint integration.
- [x] Standalone native pipeline buffers/backpressure with structured terminal
  outcomes and shared TypeScript/Python behavioral cases.
- [ ] Graph IR-integrated/durable item streaming and scheduler-integrated
  deadline/quorum barrier policies.
- [x] Compiler-validated, scheduler-integrated `RouteEquals` routing in ordinary
  and durable start/resume runs in both runtimes, with deterministic
  single/multicast policy and explicit skipped-branch terminals.
- [ ] Complete routing and barrier durability with integrated barrier settlement,
  dedicated durable `RouteSelected` history, replay identity for route decisions,
  quorum/deadline/late-arrival accounting, and cancellation policy.
- [ ] Verifier verdicts, quorum/unknown outcomes, reflection, human escalation,
  and scheduler-integrated bounded loop-until-dry primitives.
- [ ] Deterministic mock, OpenAI, Anthropic, Gemini, OpenAI-compatible, HTTP, shell,
  and MCP adapters behind explicit capability declarations.
- [ ] Ten executable TypeScript/Python patterns with failure and recovery fixtures.

The v1alpha1 Graph IR recognizes some vocabulary before its specialized runtime
capability exists. Until the corresponding gates above are complete,
`stream`/`artifact-ref` edges; `subgraph`, `validator`, and `human` nodes;
barrier policies beyond the current static all-success join; and `stateSchema`,
`resources`, and `isolation` metadata must not be described as executable or
enforced. Schema
acceptance, canonical identity, or a caller-supplied generic node executor does
not establish streaming, artifact transport, subgraph scheduling,
settled/quorum/deadline barrier behavior, verifier/human gating, state
reduction, resource control, or isolation.

## Beta — operations and external validation

- SQLite and PostgreSQL stores, leases, multi-worker CAS, artifact storage, and
  retention/compaction policy.
- OpenTelemetry traces, JSONL export, cost/budget accounting, live inspection,
  and the Graph Explorer.
- Worktree/process isolation, policy enforcement, scoped secrets, redaction, and
  approval gates.
- Doctor/score/badge hardening, randomized chaos runs, 1,000-node bounds, and
  external adopter feedback.
- Trusted npm/PyPI publishing, SBOMs, provenance, upgrade tests, and signed
  release artifacts.

## Version 1 release gate

Version 1 is released only when TypeScript and Python agree on compiler,
scheduling, routing, barriers, verification, loop convergence, persistence,
recovery, replay/fork, stable errors, and machine envelopes. Mandatory security,
clean-install, packaging, crash-injection, and external usability gates must be
green. If they are not, the project ships a complete release candidate with the
remaining blockers named instead of relabeling unfinished work as stable.

The detailed 21-day delivery graph, ownership, growth experiments, and acceptance
thresholds are maintained in
[the master plan](codex_plans/Graph-Engineering-21-Day-Master-Plan.md).

## Adoption goal

The launch target is 6,000 GitHub stars, but stars are an outcome rather than a
testable engineering guarantee. Leading indicators are first-success time,
successful graph runs, retained repositories, outside contributors, public
adopters, issue-response latency, and reproducible success/failure stories.
