# Command-line interface

Graph Engineering ships one CLI contract with native TypeScript and Python
implementations. Both expose `graph` and the compatibility alias `grapheng`,
use the same Graph IR compiler semantics, and emit the versioned
`graph-engineering.cli/v1alpha1` machine envelope. The CLI is an authoring and
inspection boundary: it never executes graph nodes, calls a model/provider, or
loads credentials.

The packages are source-only during the alpha. From a repository checkout:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @graph-engineering/cli build
node packages/cli/dist/src/cli.js doctor

uv sync --project python --extra dev
uv run --project python graph doctor
```

## Commands

```text
graph validate <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
graph plan <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
graph compile <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
graph visualize <graph.json|graph.yaml|-> [--input-format json|yaml|auto]
                [--format mermaid|dot] [--json]
graph doctor [--json]
graph init [directory] [--dry-run] [--json]
```

- `validate` decodes and compiles Graph IR, returning the graph hash and stable
  diagnostics without running it.
- `plan` reports compiler-owned topological layers, width, node/edge counts,
  and configured concurrency.
- `compile` reports the canonical Graph IR and SHA-256. It does not write a
  compiled artifact.
- `visualize` renders a valid graph as deterministic Mermaid or Graphviz DOT.
- `doctor` runs bounded local package and bundled-fixture checks without
  network access or a workspace scan.
- `init` is the only writing command. It exclusively creates `graph.json` from
  the bundled, validated Quickstart fixture and has no force/overwrite mode.

## Source selection and bounds

`auto` is the default input format. `.json` selects strict JSON and `.yaml` or
`.yml` selects the safe YAML profile; extension matching is case-insensitive.
Unknown or absent extensions fail closed. Standard input (`-`) defaults to JSON
and is never content-sniffed, so YAML on stdin requires
`--input-format yaml`.

Format selection occurs before opening a file. File and stdin readers stop at
the core 1 MiB ceiling plus one sentinel byte, and the source decoder enforces
strict UTF-8, depth/node budgets, duplicate-key rejection, and the frozen YAML
safety profile. A source failure exits `2`; a decoded document rejected by the
Graph IR compiler exits `1`.

## Machine protocol

`--json` writes exactly one newline-terminated JSON document to stdout and
nothing to stderr:

```json
{"schemaVersion":"graph-engineering.cli/v1alpha1","command":"validate","ok":true,"exitCode":0,"data":{"file":"graph.json","valid":true,"graphName":"research-diamond","graphHash":"…","diagnosticCodes":[],"diagnostics":[]},"error":null}
```

Invalid Graph IR and unhealthy doctor checks are command results, so their
details remain in `data` and `error` is null. Usage, read, source, ambiguous
format, and safe-init failures use `data: null` with a stable error object.
Source errors add `format`, JSON Pointer `path`, and one-based `line`/`column`
when available. They never include source contents, parser stacks, or absolute
paths supplied only internally.

| Exit | Meaning |
| ---: | --- |
| `0` | command success or healthy doctor |
| `1` | decoded Graph IR is invalid |
| `2` | usage, read, source, format, or safe-init failure |
| `3` | doctor found an unhealthy installation |
| `70` | unexpected internal failure |

Human-mode terminal output makes control, bidi, and lone-surrogate characters
visible instead of emitting them literally. Diagram renderers use generated
syntax identifiers and numeric encoding for caller-controlled labels; they do
not emit links, HTML labels, style directives, or executable configuration.

## Safe initialization

`init` accepts only a missing target or an existing empty, non-symlink
directory. The final file uses exclusive create/no-follow behavior and the
directory is rechecked around the write. Cleanup is limited to the exact inode
and empty directories created by that invocation—there is no recursive delete.
Use `--dry-run` to execute validation and safety checks without writing.

Implementation-specific package notes are in the
[TypeScript CLI README](../packages/cli/README.md) and
[Python README](../python/README.md).
