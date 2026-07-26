# Changelog

All notable changes are recorded here. This project follows Semantic Versioning;
pre-release APIs may change with an explicit changelog entry and protocol
migration note.

## [Unreleased]

### In progress

- Scheduler-integrated event emission, checkpoint recovery, replay, and fork.
- Streaming pipelines, conditional edge lowering, verifier panels, and bounded
  runtime loops.

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
