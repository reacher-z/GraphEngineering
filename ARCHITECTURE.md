# Architecture

Graph Engineering separates portable graph meaning from language-specific
execution.

```text
TypeScript builder ─┐
YAML / JSON ────────┼─> versioned Graph IR ─> compiler ─> durable scheduler
Python builder ─────┘                             │             │
                                                  │             ├─ node executors
                                                  │             ├─ event/checkpoint store
                                                  │             ├─ artifact store
                                                  │             └─ telemetry exporters
                                                  └─ plan / visualize / audit
```

The protocol in `spec/` defines serialization, stable diagnostics, events, and
conformance fixtures. Native runtimes may use idiomatic APIs internally, but
their observable behavior must agree on the shared corpus.

## Execution principles

- An edge exists only when data or control policy genuinely flows.
- Independent ready nodes run concurrently up to explicit limits.
- Pipelines stream independent items; barriers exist only for cross-item needs.
- Model output is validated before downstream consumption.
- Every cycle and dynamic expansion has semantic and hard resource limits.
- Node results are persisted as they succeed, so a crash does not discard an
  entire parallel stage.
- State recovery never pretends non-idempotent external effects are exactly once.

See `spec/README.md` for protocol details and the master plan under
`codex_plans/` for the complete delivery roadmap.
