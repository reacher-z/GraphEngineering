# Changelog

All notable changes are recorded here. This project follows Semantic Versioning;
pre-release APIs may change with an explicit changelog entry and protocol
migration note.

## [Unreleased]

### Added

- Native strict JSON/safe-YAML authoring in TypeScript and Python, including
  bounded parser work, deterministic source errors, duplicate-key protection,
  and shared cross-language boundary fixtures.
- Declaration-ordered builders, opt-in strict typed ports, and revision-1
  compiled identities with frozen graph, node, edge, input/output/state schema,
  and revision hashes.
- A native Python `graph`/`grapheng` CLI matching the TypeScript command,
  machine-envelope, exit-code, bounded-input, safe-init, and visualization
  contracts without delegating to Node.js.
- Portable cycle-controller checkpoint intervals in Python, matching the
  TypeScript nonnegative-safe-integer schedule when explicitly enabled, plus a
  15-row cross-language `PatchAccepted` checkpoint fault campaign proving
  stale-prefix/exact-prefix recovery and terminal latest-checkpoint identity.
- A closed 54-case hostile GraphPatch shape corpus with independent schema
  reconstruction, native TypeScript/Python execution, exact input-byte/hash
  comparison, and fail-closed depth and 4 MiB capture-bound tests.

- Event-sourced durable start and resume APIs in TypeScript and Python. Runs bind
  graph, original input, and caller-supplied implementation identity; node
  outcomes commit before releasing dependants; committed successes are reused
  after process loss.
- Cross-language tagged Durable JSON for exact finite binary64 payload hashing,
  stable activity/idempotency keys, terminal-result snapshots, and recovery
  conformance fixtures.
- Fail-closed interrupted-attempt handling: nodes declared with no or idempotent
  side effects may retry within their original budgets, while omitted or
  non-idempotent declarations surface `IN_DOUBT_SIDE_EFFECT`. Resuming a valid
  terminal run returns its recorded result with no new event or executor call.
- Native standalone `runPipeline` and `run_pipeline` APIs with lazy source
  intake, bounded end-to-end backpressure, per-stage concurrency and retry,
  input/completion delivery order, explicit stop/drop/dead-letter outcomes,
  cooperative cancellation, and shared cross-language behavioral cases.
- Evidence-gated progress scanning and a full Day 1-21 delivery control surface:
  107 registered tasks, a dependency graph, ownership map, coverage matrix,
  three organic-growth plans, and a 178-item stable-v1/RC release checklist.

### In progress

- Scheduler checkpoint acceleration, replay/fork, and distributed lease/fencing
  providers. Recovery correctness currently comes from the complete event
  stream; checkpoint files are not wired into the scheduler.
- Graph IR stream-edge lowering and durable item recovery, conditional edge
  lowering, verifier panels, and bounded runtime loops. The new standalone
  pipeline deliberately does not claim these graph/durability semantics.

## [0.1.0-alpha.1] - 2026-07-26

### Added

- Versioned Graph IR JSON Schema with explicit entrypoints and named outputs.
- Canonical UTF-8 JSON hashing and stable compiler diagnostics in TypeScript and
  Python.
- Native ready-queue DAG schedulers with bounded concurrency, retry, timeout,
  attempt budgets, cooperative cancellation, portable JSON snapshots, failure
  isolation, and named port binding.
- Shared compiler, ready-queue, invalid-output, cancellation, settled-barrier,
  route-selection, event-store, and checkpoint conformance cases.
- Deterministic native settled-barrier and route-selection primitives with
  frozen outputs, exact basis-point arithmetic, stable reason codes, and strict
  validation errors.
- Strict runtime event envelope and local memory/JSONL event stores with
  last-sequence compare-and-swap.
- Atomic, content-hashed local checkpoint stores and one shared cross-language
  hash vector.
- Safe no-overwrite `graph init`, validation, planning, canonical compilation,
  Mermaid/DOT visualization, machine JSON, and local environment diagnostics.
- Read-only MCP stdio server for bounded validation, planning, and the bundled
  Graph IR schema.
- Canonical TypeScript constructors for diamonds, verified fan-out, declarative
  routed branches, and finite until-dry expansion, plus a deterministic runnable
  showcase that labels unsupported scheduler capabilities.
- No-provider TypeScript and Python Quickstart executions over one Graph IR.
- npm tarball and Python wheel/sdist content audits, executable-bin checks, and
  clean public package metadata.
- Thirty-minute progress scanner, CI matrices, CodeQL, dependency review,
  governance, security guidance, Quickstart, concepts, and failure-mode docs.

### Known alpha boundaries

- Native schedulers are not yet wired to event/checkpoint stores, so process
  restart does not resume a run.
- Local file-store CAS coordinates one process, not multiple processes or hosts.
- Streaming pipelines, scheduler-applied conditional routing, verifier/quorum
  scheduling, runtime early-stop loops, provider adapters, sandboxing, and
  artifact stores remain planned work.
- npm and PyPI publication require trusted-publishing configuration; no package
  is published merely to reserve a name.
- This alpha exposes MCP over stdio only. The official SDK still declares an
  HTTP-adapter range with a moderate advisory; the workspace lock overrides it
  to a patched major, while standalone MCP npm publication remains gated on an
  upstream-compatible fix or a separate packaging review.

[Unreleased]: https://github.com/reacher-z/GraphEngineering/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/reacher-z/GraphEngineering/releases/tag/v0.1.0-alpha.1
