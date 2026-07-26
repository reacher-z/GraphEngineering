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

## Continue a durable run after process loss

The library APIs also support event-sourced continuation. TypeScript uses
`startDurableGraphRun` for a new stream and `resumeDurableGraphRun` for an
existing stream; Python exposes the equivalent `start_graph_run` and
`resume_graph_run`. Start and resume never silently substitute for one another.

```ts
import { JsonlEventStore } from "@graph-engineering/persistence";
import {
  resumeDurableGraphRun,
  startDurableGraphRun,
} from "@graph-engineering/runtime";

const eventStore = new JsonlEventStore({ directory: ".graph-engineering" });
const options = {
  runId: "research-001",
  implementationId: "research-handlers@1",
  eventStore,
  nodeExecutors: {
    scope: () => ({ topic: "graphs" }),
    "research-docs": () => ({ finding: "document the contract" }),
    "research-code": () => ({ finding: "test the runtime" }),
    synthesize: () => ({ summary: "graph engineering" }),
  },
};

// Invoke with --resume only in a replacement process after confirming that the
// former coordinator stopped.
const result = process.argv.includes("--resume")
  ? await resumeDurableGraphRun(graph, options)
  : await startDurableGraphRun(graph, { topic: "graphs" }, options);
```

If the run already reached a terminal event, resume simply returns its recorded
result with no new event and no executor call. After a real interrupted attempt,
automatic retry is limited to nodes declared `sideEffects: "none"` or
`"idempotent"`; omitted and non-idempotent declarations fail closed. See the
[runtime package guide](../packages/runtime/README.md) and
[durable recovery contract](../spec/durable-recovery-semantics.md) before using
this alpha API with external effects.

## Automation-friendly output

Both commands support stable JSON:

```bash
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json --json
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json --json
```

Exit code `0` means success, `1` means the graph is invalid, and `2` means the
file, source document, or command invocation could not be read. Source failures
use stable `GE_SOURCE_*` codes; compiler failures use codes such as
`GE1004_MISSING_TARGET` and `GE1005_CYCLE`.

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

This CLI slice accepts canonical Graph IR as strict JSON or the bounded safe-YAML
profile and implements `init`, `validate`, `plan`, `compile`, `visualize`, and
`doctor`. `.json`, `.yaml`, and `.yml` files are inferred in `auto` mode; stdin
defaults to JSON, so YAML on stdin must use `--input-format yaml`. Planning,
compilation, and visualization are read-only: they do not call a provider or
pretend that a model ran. Native schedulers, local persistence adapters, and
event-sourced start/resume are available as library APIs, but are not exposed by
this CLI command flow. Scheduler checkpoint acceleration, replay/fork,
distributed leases, and the Web Explorer are subsequent public slices.
