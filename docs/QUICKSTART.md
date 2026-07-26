# Quickstart: see your first graph in under five minutes

Graph Engineering turns the real data dependencies in agent work into a checked,
inspectable graph. This quickstart validates a small research diamond and shows
the two jobs that can run in parallel. It makes no model calls and needs no API
key.

## Requirements

- Node.js 20 or newer.
- Corepack, which ships with supported Node.js releases.
- A clone of this repository.

From the repository root, run:

```bash
corepack pnpm install
corepack pnpm --filter @graph-engineering/cli build
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json
```

Successful validation prints the graph's canonical SHA-256. Now draw the
deterministic execution plan:

```bash
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json
```

Expected shape:

```text
Graph plan: quickstart-research
  4 nodes · 4 edges · 3 layers
  max parallel width 2 · concurrency 2
  1. scope
  2. research-docs | research-code
  3. synthesize
```

Render the compiler-accepted topology as Mermaid text (use `--format dot` for
Graphviz DOT):

```bash
node packages/cli/dist/src/cli.js visualize examples/quickstart/research-diamond.graph.json
```

The renderer uses internal aliases and inert escaped labels; it does not execute
nodes, emit links, or write an image file.

`scope` must finish before either researcher receives its data. The two research
nodes have no edge between them, so the graph exposes their independence. Only
`synthesize` needs both outputs and earns the barrier wait.

Execute the same graph with deterministic local handlers:

```bash
corepack pnpm --filter @graph-engineering/runtime build
node examples/quickstart/run.mjs
```

The script uses the actual TypeScript ready queue, asserts observed concurrency
of two, and prints the named `report` output. It makes no provider or network
call.

The Python runtime executes the identical Graph IR natively:

```bash
uv run --project python python examples/quickstart/run.py
```

## Automation-friendly output

Both commands support stable JSON:

```bash
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json --json
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json --json
```

Exit code `0` means success, `1` means the graph is invalid, and `2` means the
file, JSON, or command invocation could not be read. Compiler failures use stable
diagnostic codes such as `GE1004_MISSING_TARGET` and `GE1005_CYCLE`.

## Safely initialize a graph project

The CLI can materialize the same compiler-validated research diamond into a new
or empty directory. Preview the exact target first:

```bash
node packages/cli/dist/src/cli.js init /tmp/my-first-graph --dry-run --json
node packages/cli/dist/src/cli.js init /tmp/my-first-graph
```

`init` never overwrites. It refuses files, symlinks, and non-empty directories;
concurrent initializers use exclusive creation so at most one succeeds. Delete
or choose a different example path if `/tmp/my-first-graph` already exists.

## Try a failure

The conformance corpus includes intentionally broken graphs:

```bash
node packages/cli/dist/src/cli.js validate spec/conformance/invalid-cycle.graph.json
```

The command exits `1` and reports `GE1005_CYCLE`. It never attempts to execute an
invalid graph.

## Current alpha boundary

This CLI slice accepts canonical Graph IR as JSON and implements `init`,
`validate`, `plan`, `compile`, and `doctor`. Planning and compilation are
read-only: they do not call a provider or pretend that a model ran. Native
schedulers and standalone local persistence adapters are available as library
APIs, but are not exposed by this Quickstart command flow. YAML input,
scheduler-integrated recovery/replay, and the Web Explorer are subsequent public
slices.
