# Quickstart research diamond

Four files, two languages, one graph:

| File | Purpose |
| --- | --- |
| `research-diamond.graph.json` | The Graph IR both runtimes execute |
| `mock-adapter.descriptor.json` | The adapter descriptor both runtimes load |
| `run.mjs` | The TypeScript runner |
| `run.py` | The Python runner |

The graph makes the first Graph Engineering distinction visible: the two research
nodes consume the same scoped topic but not each other's output, so they belong
in one parallel layer. The synthesis node is the only place that waits for both
results.

```text
scope
  ├── research-docs ──┐
  └── research-code ──┴── synthesize
```

## Run it

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
node examples/quickstart/run.mjs
```

```bash
uv run --project python python examples/quickstart/run.py
```

Both runners are self-checking: every claim they print is also an assertion. If
an assertion fails the script exits non-zero instead of printing a comfortable
summary.

## What they do

1. **Execute the diamond on the native scheduler.** The two research nodes are
   model-shaped: each dispatches through the deterministic mock adapter and
   returns its structured output. Observed concurrency of two is asserted, not
   assumed.
2. **Show the adapter boundary refusing.** Requesting a capability the descriptor
   does not declare is refused at the `pre-dispatch` boundary with
   `GE_ADAPTER_CAPABILITY_UNSUPPORTED` and `usage: null`.
3. **Run the same graph durably, with payload protection configured.** A durable
   start with no protected store and no key provider fails closed with
   `PAYLOAD_PROTECTION_REQUIRED` before any event, temporary file, or executor
   call. With protection configured, the run succeeds and every byte written
   under the run directory is scanned: the plaintext topic appears in none of
   them.
4. **Resume the terminal run.** It returns the recorded result with zero
   executor calls.

Everything is deterministic and requires no API key or network access. The key
material in step 3 is minted per process from the platform CSPRNG; it is
deliberately not a KMS, and a run protected with it cannot be recovered by a
later process.

## The plan, without executing

```bash
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js visualize examples/quickstart/research-diamond.graph.json
```

```text
1. scope
2. research-docs | research-code
3. synthesize
```

There is no `graph run` CLI command. Execution is a library API, which is what
these two scripts call directly.
