# Quickstart: a real run in three commands

Graph Engineering turns the real data dependencies in agent work into a checked,
inspectable graph. This quickstart executes a small research diamond on the
native scheduler, drives its two research nodes through the deterministic mock
adapter, persists the same run to a protected durable journal, and resumes it.

It makes no network call, needs no API key, and holds no credential.

## Requirements

- Node.js 20 or newer, with Corepack (ships with supported Node.js releases).
- Optional, for the Python lane: [uv](https://docs.astral.sh/uv/) and Python 3.11
  or newer.
- A clone of this repository. Nothing is published to npm or PyPI; there is no
  `npm install` or `pip install` path yet.

## TypeScript: three commands

From the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
node examples/quickstart/run.mjs
```

The quickstart itself needs only three built packages, so
`corepack pnpm --filter "@graph-engineering/runtime..." --filter "@graph-engineering/adapters..." build`
is enough if you would rather not build the optional `@graph-engineering/sqlite`
package, which requires Node.js 22.16.0 or newer.

Actual output:

```json
{
  "1-parallel-run": {
    "status": "succeeded",
    "maxObservedConcurrency": 2,
    "adapterDispatches": 2,
    "report": {
      "code": {
        "finding": "Test the runtime for durable agent graphs",
        "source": "code"
      },
      "docs": {
        "finding": "Document the contract for durable agent graphs",
        "source": "docs"
      }
    }
  },
  "2-adapter-boundary": {
    "refusedCapability": "streaming",
    "code": "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
    "boundary": "pre-dispatch",
    "usage": null
  },
  "3-durable-protected": {
    "unprotectedStart": "PAYLOAD_PROTECTION_REQUIRED",
    "status": "succeeded",
    "protectedJournalBytesOnDisk": 22894,
    "plaintextTopicOnDisk": false
  },
  "4-resume": {
    "status": "succeeded",
    "totalAdapterDispatches": 4,
    "executorCallsDuringResume": 0
  }
}
```

## Python: one command

The Python runtime is native, not a client for the TypeScript executor. It reads
the same Graph IR file and the same adapter descriptor file:

```bash
uv run --project python python examples/quickstart/run.py
```

`uv` creates the environment on first use, so this is a single command from a
fresh clone. The output is the same four sections, with keys sorted.

## What each section proves

### 1. Two model-shaped nodes run in parallel

`scope` must finish before either researcher receives its data. The two research
nodes have no edge between them, so the graph exposes their independence. Only
`synthesize` needs both outputs and earns the wait. The script asserts an
observed concurrency of two — the lanes really overlap; this is execution, not a
plan drawing.

Each research node dispatches through the **deterministic mock adapter**, the
reference implementation of `adapter-contract/v1alpha1`. It reads no clock,
opens no socket, spawns no process, and requires no credential: every observable
it produces is a function of its descriptor
([`mock-adapter.descriptor.json`](../examples/quickstart/mock-adapter.descriptor.json)),
its script, and the request. Swapping in a different adapter kind does not change
the graph.

### 2. The adapter boundary refuses before dispatch

The quickstart descriptor declares three capabilities. Asking the same adapter
for `streaming`, which it does not declare, is refused at the `pre-dispatch`
boundary with `GE_ADAPTER_CAPABILITY_UNSUPPORTED` and `usage: null`: a refused
call performs zero provider requests, zero usage, and zero ledger writes. A
caller cannot reach an undeclared capability by any request shape.

### 3. The durable path is protected, and fails closed without protection

A durable run persists authoritative application values. It therefore requires an
operator-supplied protected payload store and key provider. The quickstart first
calls the durable start **without** them, and gets:

```text
PAYLOAD_PROTECTION_REQUIRED
```

That refusal happens before the first event, the first temporary file, and the
first executor call — the counter in the output confirms no executor ran. There
is no fallback to an inline plaintext writer.

Configuring protection is the eight lines the quickstart then shows: a guarded
journal, a protected blob store, a key provider, an opaque authority scope, and a
capture policy that names the key reference actually in use. The quickstart mints
key material per process from the platform CSPRNG. A deployment holds it in a
KMS; it is never written beside the ciphertext, so losing it means losing the
journal.

After the protected run succeeds, the script scans every byte written under the
run directory and asserts that the plaintext topic string appears in none of
them. Authoritative values reach the journal only as validated protected
references.

Honest boundary: a recovered value is decoded into process memory so the
scheduler can bind it as node input. Protection does not hide values from an
authorized executor after decryption, and it is not a KMS, an escrow, or a
rotation schedule.

### 4. Resume replays a terminal run without executing anything

Start and resume never silently substitute for one another. Resuming a run that
already reached a terminal event returns its recorded result with no new event
and no executor call — the dispatch counter is unchanged across the resume.

After a genuinely interrupted attempt, automatic retry is limited to nodes
declared `sideEffects: "none"` or `"idempotent"`; omitted and non-idempotent
declarations fail closed with `IN_DOUBT_SIDE_EFFECT`. See the
[runtime package guide](../packages/runtime/README.md) and the
[durable recovery contract](../spec/durable-recovery-semantics.md) before using
this alpha API with external effects.

## Inspect the graph without running it

The CLI is read-only: it never calls a provider and never pretends that a model
ran.

```bash
node packages/cli/dist/src/cli.js validate examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js plan examples/quickstart/research-diamond.graph.json
node packages/cli/dist/src/cli.js visualize examples/quickstart/research-diamond.graph.json
```

`plan` prints the deterministic execution plan:

```text
Graph plan: quickstart-research
  4 nodes · 4 edges · 3 layers
  max parallel width 2 · concurrency 2
  1. scope
  2. research-docs | research-code
  3. synthesize
```

`visualize` renders Mermaid text (`--format dot` for Graphviz DOT) using internal
aliases and inert escaped labels; it does not execute nodes, emit links, or write
an image file.

The Python CLI accepts the same commands:

```bash
uv run --project python python -m graph_engineering.cli plan examples/quickstart/research-diamond.graph.json
```

## Automation-friendly output

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

```text
✗ invalid-cycle.graph.json is invalid (1 diagnostic(s))
  GE1005_CYCLE [one,two]: Graph contains a cycle involving: one, two
```

The command exits `1`. It never attempts to execute an invalid graph.

## Current alpha boundary

- The CLI accepts canonical Graph IR as strict JSON or the bounded safe-YAML
  profile and implements `init`, `validate`, `plan`, `compile`, `visualize`,
  `doctor`, and the read-only run commands `status`, `inspect`, and `logs`.
  `.json`, `.yaml`, and `.yml` are inferred in `auto` mode; stdin defaults to
  JSON, so YAML on stdin must use `--input-format yaml`.
- `cancel`, `resume`, `replay`, `fork`, and `retry` parse but deliberately
  refuse: the underlying operational capability does not exist yet, and both
  CLIs report the same capability name rather than pretending.
- There is no `graph run` command. Execution is a library API, exercised by
  `examples/quickstart/run.mjs` and `run.py`.
- Node executors have the ambient authority of the host process. There is no
  isolation provider; see [`spec/isolation-semantics.md`](../spec/isolation-semantics.md) §0.
- No provider client ships. The HTTP adapter takes an injected transport with no
  default; the shell adapter refuses to execute at all, because a launch would
  run with the host process's authority.

## Next reading

- [Concepts](./CONCEPTS.md)
- [Failure modes](./FAILURE_MODES.md)
- [CLI contract](./CLI.md)
- [Runtime package guide](../packages/runtime/README.md)
- [Adapter package guide](../packages/adapters/README.md)
