# Contributing to Graph Engineering

Thank you for helping build reliable agent graphs. The easiest contribution
path is documentation, then an executable pattern, an adapter, and finally a
runtime change.

## Before opening a change

1. Search existing issues and discussions.
2. For public protocol or runtime semantic changes, open a design issue first.
3. Keep one concern per pull request.
4. Add tests and user-facing documentation for new behavior.

## Local verification

TypeScript packages use pnpm through Corepack:

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm typecheck
```

Python uses uv:

```bash
uv sync --project python --extra dev
uv run --project python pytest python/tests
uv run --project python ruff check python/src python/tests
uv run --project python mypy python/src
```

Changes affecting the Graph IR, compiler diagnostics, event protocol, or
scheduler semantics must pass the cross-language conformance suite.

## Pull requests

- Explain the problem and observable behavior.
- Include the exact verification commands and results.
- Call out compatibility, security, cost, and recovery implications.
- Never include credentials, private prompts, or production trace payloads.

All contributions are licensed under the repository's MIT License.
