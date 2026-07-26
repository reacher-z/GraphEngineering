# `@graph-engineering/cli`

Command-line tools for canonical Graph Engineering Graph IR. The alpha CLI
validates graphs, explains deterministic topology, exposes the exact canonical
compiler result, renders safe topology diagrams, checks the local installation,
and safely initializes a minimal project. It does not execute graph nodes, call
a model, access credentials, or mutate an input graph. `init` is the only command
in this slice that writes.

## Commands

```bash
graph validate graph.json
graph validate graph.yaml
graph plan graph.json
graph compile graph.json
graph compile - --input-format yaml
graph visualize graph.json
graph visualize graph.yaml --input-format auto
graph visualize graph.json --format dot
graph doctor
graph init my-graph
graph init my-graph --dry-run
```

`validate`, `plan`, `compile`, and `visualize` accept JSON or safe YAML files and
`-` for standard input. Add `--json` before or after the command operands for
automation:

```bash
graph --json validate graph.json
graph plan graph.json --json
graph compile graph.json --json
graph compile graph.yaml --input-format yaml --json
graph visualize graph.json --json
graph visualize - --input-format yaml --format dot --json
graph doctor --json
graph init my-graph --json
graph init my-graph --dry-run --json
```

- `validate` reports canonical compiler validity, SHA-256, and stable diagnostic
  codes.
- `plan` reports topological layers, graph width, node/edge counts, and configured
  concurrency. It never runs a node.
- `compile` is read-only. Its human output is a short hash/byte-count summary;
  JSON mode includes `canonicalGraph`. Both `canonicalGraph` and `graphHash` are
  returned unchanged from `@graph-engineering/core`; this package contains no
  second compiler or hashing implementation.
- `visualize <graph.json|graph.yaml|->` first runs the canonical core compiler and renders
  only a valid Graph IR. Mermaid flowchart text is the default; `--format dot`
  emits Graphviz DOT. Human mode writes only the diagram to stdout. It performs
  no node execution, configuration discovery, network access, or writes.
- `doctor` checks Node.js 20+, the package-owned Graph IR schema and diamond
  fixture, and whether the installed core and runtime expose their expected
  entry points. It reads only those two fixed bundled files and resolves local
  packages—no network, credential, workspace scan, or user-supplied path.
- `init [directory]` creates `graph.json` from the package-bundled
  `quickstart/research-diamond.graph.json`. The template is byte-identical to the
  repository quickstart and is validated by the canonical core compiler before
  any write. The directory defaults to `.`. `--dry-run` performs all safety
  checks and reports planned output without creating a directory or file.

## JSON and safe YAML input

Input selection and visualization output are independent:

- `--input-format json|yaml|auto` chooses the Graph IR source decoder. `auto` is
  the default.
- In `auto`, `.json` uses JSON and `.yaml`/`.yml` uses YAML. Extension matching
  is case-insensitive. An unknown or absent extension fails closed; use an
  explicit `json` or `yaml` override when that filename is intentional.
- Standard input (`-`) in `auto` is always JSON. The CLI never sniffs content;
  YAML on stdin requires `--input-format yaml`.
- `visualize --format mermaid|dot` chooses diagram output only. It never changes
  source decoding, and it can be combined with `--input-format`.

The CLI reads raw bytes and delegates decoding to the canonical
`@graph-engineering/core` source decoder. UTF-8 is fatal rather than replacing
bad bytes. YAML is limited to one JSON-compatible YAML 1.2 document and rejects
duplicate keys, anchors, aliases, merge keys, tags, directives, non-string keys,
non-finite or unsafe numbers, excessive size/depth/node counts, parser recovery,
and other non-JSON values. The CLI has no second YAML parser or safety policy.

Source decoding and Graph IR compilation are distinct gates. An unreadable,
malformed, unsafe, or ambiguous-format source exits `2`; a successfully decoded
document rejected by the canonical compiler exits `1` with compiler
diagnostics. Both JSON and YAML produce the same detached Graph IR snapshot
before compilation, so equivalent documents have the same canonical graph and
hash.

## Safe initialization boundary

`init` succeeds only when its target does not exist or is an existing empty,
non-symlink directory. It refuses a target symlink, file, special entry, or any
directory containing even one existing entry. There is no force/overwrite mode.

The final `graph.json` create uses exclusive-create and no-follow flags, so a
file appearing after inspection is rejected instead of overwritten. The target
directory identity and contents are rechecked around the write. Concurrent
`init` calls against one target therefore produce one project and at most one
success.

If creation fails, cleanup is deliberately narrow: only the `graph.json` inode
opened by that invocation and empty directories explicitly created by that
invocation are eligible. Cleanup never recursively removes a directory and
never deletes pre-existing or identity-mismatched entries. `init` invokes no
shell, network service, or credential provider.

## Machine protocol

Every `validate`, `plan`, `compile`, `visualize`, `doctor`, or `init` invocation using
`--json` writes exactly one newline-terminated JSON document to standard output
and writes nothing to standard error. Success, invalid graphs, bad input,
refused init targets, and an unhealthy doctor all use the same versioned
envelope:

```json
{"schemaVersion":"graph-engineering.cli/v1alpha1","command":"compile","ok":true,"exitCode":0,"data":{"file":"graph.json","valid":true,"graphName":"example","graphHash":"…","canonicalGraph":"{…}","canonicalBytes":123,"diagnosticCodes":[],"diagnostics":[]},"error":null}
```

A successful visualization has exactly these command data fields:

```json
{"graphHash":"…","format":"mermaid","content":"flowchart TD\n…\n","nodeCount":4,"edgeCount":4}
```

Command results live in `data`. Usage and read failures set `data` to `null` and
return a stable `{code, message}` in `error`. Source decoder failures additionally
return `format`, JSON Pointer `path`, and 1-based `line`/`column`; unavailable
locations are `null`. Source-decoder errors do not include source text, parser
stacks, or an absolute user path; read errors retain the requested path. Invalid
Graph IR and unhealthy doctor reports remain structured command results, so
their diagnostics/checks are in `data` and `error` is `null`.

For example, malformed YAML returns one machine envelope and exit `2`:

```json
{"schemaVersion":"graph-engineering.cli/v1alpha1","command":"validate","ok":false,"exitCode":2,"data":null,"error":{"code":"GE_SOURCE_DUPLICATE_KEY","message":"YAML mapping keys must be unique","format":"yaml","path":"#/kind","line":2,"column":1}}
```

Without `--json`, successful summaries or diagram text are written to stdout.
Usage/input errors and invalid-graph diagnostics are written to stderr. `doctor`
always writes its human-readable report to stdout because failed health checks
are report data. Human-readable output preserves ordinary path text but renders
terminal controls—including newlines, escape/C1 sequences, and bidirectional
controls—as visible `\u{NNNN}` text. Machine mode retains normal JSON escaping.

## Stable exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Command succeeded, or `doctor` is healthy |
| `1` | Graph IR is invalid |
| `2` | Usage/read/source error, ambiguous input format, or refused/failed safe initialization |
| `3` | `doctor` found an unhealthy local installation |
| `70` | Unexpected internal error |

JSON/safe-YAML decoding, Graph hashing, canonical serialization, semantic
diagnostics, reachability, policy checks, and topological layers are owned by
`@graph-engineering/core`.
The public JavaScript API intentionally exposes validation/planning adapters but
does not re-export `compileGraph`.

## Deterministic and safe diagram text

Node and edge statements retain their Graph IR declaration order and use only
generated `n0`, `n1`, … and `e0`, `e1`, … syntax identifiers. Labels mark node
IDs and kinds, entrypoints, named outputs (including output ports), plus edge
IDs, endpoint ports, and modes.

Caller-controlled label characters outside a small ASCII text alphabet are
encoded as numeric entities before they reach Mermaid or DOT syntax. In
particular, quotes, line breaks, brackets, pipes, angle brackets, ampersands,
backticks, slashes, and control/Unicode characters cannot create statements,
attributes, links, or HTML. The renderer emits no `click`, URL/href, target,
HTML-label, style, or class directive.
