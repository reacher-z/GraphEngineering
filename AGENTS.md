# Repository agent guidance

## Product invariants

- `spec/` is the canonical cross-language protocol source.
- TypeScript and Python behavior must stay aligned through conformance fixtures.
- Failures are structured values or events; never silently replace them with null.
- Deterministic transforms handle plumbing; model nodes handle judgment.
- Implicit graph cycles, unbounded retries, and unbounded dynamic fan-out are invalid.
- External side effects are at-least-once and require idempotency or approval.
- Telemetry and prompt/response capture are off by default.

## Ownership during parallel work

- Main/integration agent owns root configuration, `spec/`, `codex_plans/`, and `codex_logs/`.
- TypeScript runtime work owns `packages/core/` and `packages/runtime/`.
- Python runtime work owns `python/`.
- Platform work owns `packages/cli/`, `packages/mcp-server/`, `apps/`, `tools/`, `docs/`, and `examples/` when assigned.

Do not edit another lane's files without an explicit handoff. Preserve unrelated
changes in the shared worktree.

## Verification

- Run focused tests for every changed package.
- Public behavior requires tests and documentation.
- Never run a rewriting formatter across files owned by another task.
- Real model-provider tests are opt-in; normal tests use deterministic fakes.
