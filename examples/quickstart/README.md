# Quickstart research diamond

This graph makes the first Graph Engineering distinction visible: the two
research nodes consume the same scoped topic but not each other's output, so
they belong in one parallel layer. The synthesis barrier is the only place that
waits for both results.

```text
scope
  ├── research-docs ──┐
  └── research-code ──┴── synthesize
```

Validate and inspect it from the repository root:

```bash
corepack pnpm --filter @graph-engineering/cli build
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js visualize examples/quickstart/research-diamond.graph.json
```

Then execute it through the real TypeScript scheduler with deterministic local
handlers—still without an API key:

```bash
corepack pnpm --filter @graph-engineering/runtime build
node examples/quickstart/run.mjs
```

The script asserts that the two research handlers actually overlap and reports
`"maxObservedConcurrency": 2`; this is execution, not a simulated CLI plan.

Run the same Graph IR through the native Python scheduler:

```bash
uv run --project python python examples/quickstart/run.py
```

Both scripts consume one graph file and assert the same named output and
concurrency behavior.

The expected plan has three layers with a maximum parallel width of two:

```text
1. scope
2. research-docs | research-code
3. synthesize
```

This alpha example is deterministic and requires no API key. Provider adapters
and a public `graph run` CLI arrive in later slices; the example calls the native
runtime library directly and never pretends that planning executed a model.
