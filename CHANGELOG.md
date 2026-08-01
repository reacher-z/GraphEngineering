# Changelog

All notable changes are recorded here. This project follows Semantic Versioning;
pre-release APIs may change with an explicit changelog entry and protocol
migration note.

## [Unreleased]

## [0.2.0-alpha.2] - 2026-08-01

This is an alpha. Read "What is not in this release" before you read the
additions; it is the more important half of this entry.

### Added

- Sink-before-write redaction in TypeScript and Python. A protected journal has
  no raw append path: `ProtectedJsonlEventStore` consumes only a
  `PreparedSinkWrite` bound to that instance, and Python's
  `GuardedJsonlEventStore.write` raises `UnguardedWriteError` for anything else.
  On the durable scheduler path, payload protection is mandatory and fails with
  `PAYLOAD_PROTECTION_REQUIRED` before the first event, checkpoint, log, error
  payload, temporary plaintext file, or executor invocation. There is no no-op
  key provider, no in-process default store, and no fallback to the legacy
  inline writer. This guard covers the durable event journal only; see the
  checkpoint-store boundary below.
- Provider and tool adapters in both languages: a deterministic mock adapter
  that performs no network access, requires no credential, reads no clock and
  spawns no process; an HTTP adapter whose transport must be injected, with no
  default transport and no network fallback; and a shell adapter that always
  refuses to execute and imports no `child_process`/`subprocess` at all.
- Integrated barrier execution in the TypeScript *ordinary* scheduler. An
  integrated barrier never enters the ready queue; it is decided at a quiescence
  point with zero executor attempts. The TypeScript durable scheduler and both
  Python schedulers refuse it before dispatch.
- A `GE1421`-`GE1424` compiler pass in both languages —
  `GE1421_INVALID_BARRIER_POLICY`, `GE1422_BARRIER_POLICY_KIND_MISMATCH`,
  `GE1423_BARRIER_NO_INPUTS`, `GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS` — with
  contractual category ordering and a local suppression chain, plus pre-dispatch
  runtime-capability refusal (`runtime-capability/v1alpha1`) in both languages.
  This is refusal based on declarations, not execution-time enforcement.
- Durable operational CLI commands in both languages. `status`, `inspect`, and
  `logs` read both journal contracts — `events/v1alpha2` (protected) and the
  legacy `events/v1alpha1` — opening the file read-only and never resolving a
  protected reference, so no key material is required. `cancel`, `resume`,
  `replay`, `fork`, and `retry` fail closed with a named missing capability.
- Five newly frozen contracts, each with a case corpus and a `.validate.mjs`
  oracle wired into `pnpm validate:fixtures` in CI: `approval-semantics`,
  `durable-extension-semantics`, `isolation-semantics`,
  `verification-semantics`, and `adapter-semantics`. Four of the five are
  explicitly contract-only with `implementationClaim: false`; only
  `adapter-semantics` has native implementations. A frozen contract is not an
  implemented feature.
- One complete pattern bundle: `examples/patterns/research-diamond/` (Pattern
  01, the multi-source research diamond), with byte-equivalent JSON/YAML graphs,
  committed fixtures, and TypeScript and Python runners.
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
- A closed 24-case schema-valid GraphPatch semantic corpus with native
  TypeScript/Python decision parity, cumulative dynamic-node enforcement,
  resource/config capability ceilings, exact retry and dry-run ID behavior,
  historical accepted replay, and one-winner same-base CAS coverage.
- A closed 34-case hostile GraphPatch replay/restore corpus with byte-identical
  native decision seeds, strict durable-carrier validation, fail-before-mutation
  tamper rejection, stale-rejection lineage recovery, graph/dynamic limit gates,
  and complete duplicate-decision conflict parity in TypeScript and Python.
- Bounded `cycle-controller-lineage/v1alpha1` manifests, native exporters and
  zero-dispatch offline replay in TypeScript and Python. Multi-generation forks
  now resolve complete ancestry; a 20-case cross-language campaign covers
  grandchild, sibling and distinct-prefix behavior plus 16 rehashed hostile
  missing/duplicate/cyclic/corrupt/boundary cases.
- Provider-neutral `cycle-store-provider/v1alpha1` contracts and deterministic
  TypeScript/Python memory oracles. The closed 54-case differential campaign
  proves exact-tail append CAS, operation-ledger ambiguity recovery, snapshot
  pagination, disposable checkpoints, provider-clock lease fencing, tenant
  authorization, safe errors, legal holds, and migration exclusion while
  retaining explicit nonclaims for durability and distributed fencing.
- Same-host durable SQLite CycleStore adapters in TypeScript and Python with one
  owned connection, WAL/`FULL` durability policy, bounded writer retries,
  persistent leases and migration fences, single-use snapshot cursors,
  canonical v0-to-v1 migration assets, semantic integrity audits, native online
  backup, manifest-bound restore to a new path, and cross-language file access.
  The adapters are held to the shared 54-case provider campaign and a separate
  36-case SQLite durability/attack campaign. Eight retained same-file
  TypeScript/Python interop scenarios cover both ownership directions,
  snapshot isolation, writer races, lease takeover, and bidirectional
  backup/restore. They do not claim multi-host fencing, network-filesystem
  safety, scheduler checkpoint authority, or operation-ledger replay closure.
- A contract-frozen 96-case SQLite operation-ledger replay campaign (48
  behavior, 48 attack) and a closed TypeScript storage codec for all nine
  canonical mutation requests. These freeze the schema-v2 remediation inputs;
  they do not claim that baseline migration or deterministic replay is already
  implemented.
- Native Node and Python SQLite characterization harnesses covering the same
  append, contention, read, checkpoint, lease, semantic-audit, backup, and
  restore workload inventory with raw samples and explicit nonclaims.

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

### What is not in this release

Every item below is absent, not partial. If you need one of them, this release
cannot do it.

- **No isolation runtime.** There is no isolation provider, capability engine,
  or merge gate. A node executor has the ambient authority of the host process
  that runs it. The `isolation` IR field is refused before dispatch, not
  enforced.
- **No capability enforcement.** Declarations are refused before dispatch or
  they are ignored; nothing observes or constrains what a node actually does at
  execution time. Nothing stops a node from performing IO it did not declare.
- **No verification, judge, or citation runtime.** `verification-semantics` is a
  frozen contract with `implementationClaim: false`. No TypeScript or Python
  runtime implements it.
- **No budget or cost runtime.** `budget-semantics` is a contract candidate, not
  accepted. `maxCostUsd` is refused as the `cost-budget` capability. Declared
  budgets are documentation.
- **No React Explorer and no web UI of any kind.** There is no `.tsx` file in
  the repository.
- **Nine of the ten planned pattern bundles.** One is complete. Of the five
  TypeScript pattern constructors, only `researchDiamond` has a Python peer, and
  `loopUntilDry` is a blueprint no scheduler here runs: the graph compiles, then
  the runtime fails it closed with `UNSUPPORTED_EDGE_CONDITION` before any
  executor is invoked, because its `LoopDryVerdict`/`LoopContinue` conditions
  are not `RouteEquals` on a router.
- **No fourteen-step course.** No course material of any length ships here.
- **No PostgreSQL and no S3 backend.** Local files and same-host SQLite only.
- **No distributed workers.** Single-process async concurrency. Compare-and-swap
  rejects a stale append but is not a lease; there is no multi-host fencing.
- **No provider client.** No OpenAI, Anthropic, or other network client exists.
  The provider-family names are closed enum members of a vocabulary, not
  implementations. The only outbound call site in the adapters tree is the
  caller-injected transport.
- **No npm package and no PyPI package.** Nothing is published to either
  registry for this version. Build from source.

Two scope limits on features that *are* in this release, stated plainly:

- **Integrated barriers execute only in the ordinary TypeScript scheduler.** The
  durable TypeScript scheduler refuses them, because it does not yet journal
  `BarrierSatisfied`. Python executes them nowhere: the Python integrated
  barrier runtime module is imported by nothing but its own test, and the Python
  scheduler refuses any non-trivial barrier config under the generic
  `node-config:barrier` capability name rather than the dedicated
  `integrated-barrier-policy` name TypeScript uses.
- **Durable payload protection is mandatory on the event journal, not
  everywhere.** `FileCheckpointStore` is entirely unguarded in both languages: a
  caller who creates a checkpoint with application values writes plaintext
  canonical JSON to disk. Only the identifiers are hashed, into the filename.
  The unprotected `JsonlEventStore` and `MemoryEventStore` also remain exported
  public API in both languages.

### Still in progress

- Scheduler checkpoint acceleration and distributed/multi-host lease providers.
  Recovery correctness currently comes from the complete event stream; the
  SQLite CycleStore is not yet wired into scheduler checkpoint recovery.
- Graph IR stream-edge lowering and durable item recovery, conditional edge
  lowering, verifier panels, and bounded runtime loops. The standalone pipeline
  deliberately does not claim these graph/durability semantics.
- Cross-language terminal durable-history interop (`D9-DURABLE-INTEROP`) is not
  executed. A guarded store has no way to adopt a foreign committed
  `events/v1alpha2` history plus its protected blobs, so neither direction of
  the harness can be built. The conformance run prints this on every execution:
  it is a declared gap, not a silent skip.

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

[Unreleased]: https://github.com/reacher-z/GraphEngineering/compare/v0.2.0-alpha.2...HEAD
[0.2.0-alpha.2]: https://github.com/reacher-z/GraphEngineering/compare/v0.1.0-alpha.1...v0.2.0-alpha.2
[0.1.0-alpha.1]: https://github.com/reacher-z/GraphEngineering/releases/tag/v0.1.0-alpha.1
