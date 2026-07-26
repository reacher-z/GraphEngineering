# Architecture

Graph Engineering separates portable graph meaning from language-specific
execution.

```text
Canonical Graph IR JSON ─> compiler ─┬─> in-memory ready-queue scheduler
                                     ├─> event-sourced start/resume
                                     └─> plan / Mermaid / DOT / audit

Independent JSON items ─> standalone bounded pipeline ─> terminal item results
```

The protocol in `spec/` defines serialization, stable diagnostics, events, and
conformance fixtures. Native runtimes may use idiomatic APIs internally, but
their observable behavior must agree on the shared corpus.

The current authoring layer includes general TypeScript/Python builders, a
bounded JSON-compatible YAML profile, opt-in strict-exact typed ports, and
revision-1 component identities. ArtifactStore/LockManager,
SQLite/PostgreSQL/S3, distributed workers, and telemetry exporters remain target
surfaces. Local memory/JSONL events and file checkpoints exist today. Recovery
currently rebuilds from the authoritative event history; checkpoint
acceleration is not wired into scheduling.

## Execution principles

- An edge exists only when data or control policy genuinely flows.
- Independent ready nodes run concurrently up to explicit limits.
- The standalone pipeline streams independent items through bounded buffers;
  Graph IR `edge.mode: "stream"` remains declarative and is not durable item
  streaming.
- Pure router and settled-barrier evaluators are deterministic; scheduler-level
  conditional routing and deadline/quorum waiting remain planned.
- Executor output is checked for detached portable JSON before downstream
  consumption; runtime JSON Schema validation remains planned.
- Every future cycle and dynamic expansion must have semantic and hard resource
  limits; the current scheduler rejects implicit cycles and does not execute
  dynamic GraphPatch revisions.
- Node results are persisted as they succeed, so a crash does not discard an
  entire parallel stage when callers use event-sourced start/resume. Plain
  `runGraph` remains in-memory.
- State recovery never pretends non-idempotent external effects are exactly once.

See `spec/README.md` for protocol details and the master plan under
`codex_plans/` for the complete delivery roadmap.
