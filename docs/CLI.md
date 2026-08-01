# Command-line interface

Graph Engineering ships one CLI contract with native TypeScript and Python
implementations. Both expose `graph` and the compatibility alias `grapheng`,
use the same Graph IR compiler semantics, and emit the versioned
`graph-engineering.cli/v1alpha1` machine envelope. The CLI is an authoring and
inspection boundary: it never executes graph nodes, calls a model/provider, or
loads credentials. The durable operations surface inherits that boundary — it
reads run history and never mutates it, in either the protected
`events/v1alpha2` journal this runtime writes today or a legacy
`events/v1alpha1` one. There is no `graph run` command; execution is a library
API.

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
graph status  --run <runId> --store <directory> [--json]
graph inspect --run <runId> --store <directory> [--json]
graph logs    --run <runId> --store <directory> [--from <sequence>]
              [--limit <count>] [--json]
graph cancel  --run <runId> --store <directory> [--json]
graph resume  --run <runId> --store <directory> [--json]
graph replay  --run <runId> --store <directory> [--json]
graph fork    --run <runId> --store <directory> [--json]
graph retry   --run <runId> --node <nodeId> --store <directory> [--json]
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
- `status`, `inspect`, and `logs` project one durable run history. They are the
  only operational commands this runtime can honestly serve, and they read both
  durable journal layouts — see
  [Journal contracts](#journal-contracts).
- `cancel`, `resume`, `replay`, `fork`, and `retry` fail closed. See
  [Unimplemented durable operations](#unimplemented-durable-operations).

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
| `4` | the named durable run history does not exist |
| `5` | the durable run history is malformed |
| `6` | the requested durable capability is not implemented |
| `70` | unexpected internal failure |

Human-mode terminal output makes control, bidi, and lone-surrogate characters
visible instead of emitting them literally. Diagram renderers use generated
syntax identifiers and numeric encoding for caller-controlled labels; they do
not emit links, HTML labels, style directives, or executable configuration.

## Durable operations

`status`, `inspect`, and `logs` read one durable run journal. Both `--run` and
`--store` are required; there is no default store path.

### Journal contracts

A durable store can carry either of two journal layouts, and these commands read
both:

| Contract | Path | Written by |
| --- | --- | --- |
| `events/v1alpha2` | `<store>/events-v1alpha2/<hash>.jsonl` | the protected durable scheduler, which is what this runtime writes today |
| `events/v1alpha1` | `<store>/events/<hash>.jsonl` | the pre-redaction-cut durable scheduler; legacy data under `redaction-semantics.md` Section 9 |

The protected layout is probed first, then the legacy one. A store that carries
both for one run identity therefore projects the protected journal, and the
legacy file is neither read nor touched. Every successful projection reports the
contract it found in `journalApiVersion`, and human output names it on a
`journal events/v1alpha2` or `journal events/v1alpha1` line. Neither layout is
inferred from a record: the directory a journal lives in declares its contract,
and a record whose `apiVersion` states the other one fails `5`
`GECLI_HISTORY_MALFORMED`.

Reading a protected journal requires no key provider and this CLI accepts none.
A v1alpha2 envelope carries its own closed metadata inline — `sequence`, `type`,
`nodeId`, `edgeId`, `attempt`, `timestamp`, `redacted`, `payloadDisposition` —
which is everything these three projections use. `event.data` is never read, so
a protected reference is never resolved and no plaintext payload can reach a
sink. That is also why the envelope member lists below are identical for both
contracts.

`--run` must match the durable safe-identifier grammar
`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`, otherwise the CLI exits `2` with
`GECLI_RUN_ID_INVALID` and never echoes the rejected value.

These commands are strictly append-free. They open the journal read-only, take
no lock, and create no directory or temporary file, so they succeed against a
read-only store. Both language test suites and the cross-language conformance
join fingerprint the journal bytes, size, and modification time around every
invocation and fail if any of them moves.

Nothing is inferred from outside the journal. The lifecycle status is derived
only from event types the history actually contains:

| `status` | Derived from |
| --- | --- |
| `created` | only `RunCreated` so far |
| `running` | the last lifecycle record is `RunStarted` or `RunResumed` |
| `paused` | the last lifecycle record is `RunPaused` |
| `succeeded` / `failed` / `cancelled` | the matching terminal record |

The exit code reports the CLI operation, never the run outcome: reading a failed
or cancelled run is still exit `0`. Read `data.status` for the run.

`logs` pages the journal with `--from <sequence>` (default `0`) and
`--limit <count>` (default `200`, maximum `10000`). `data.nextSequence` is the
cursor for the next page, or `null` when the window reached the end. A journal
larger than 64 MiB is refused rather than buffered.

### Machine envelopes

Every operational command uses the shared envelope. `data` members are a closed,
ordered allowlist, identical for both journal contracts; `journalApiVersion`
names the contract the read found:

```json
{"schemaVersion":"graph-engineering.cli/v1alpha1","command":"status","ok":true,"exitCode":0,"data":{"runId":"…","runIdHash":"…","journalApiVersion":"graphengineering.reacher-z.github.io/events/v1alpha2","status":"succeeded","terminal":true,"eventCount":19,"lastSequence":18,"graphRevision":1,"firstEventTimestamp":"…","lastEventTimestamp":"…","resumeCount":0,"pauseCount":0,"observedNodeCount":4,"redaction":{"sink":"cli-json","eventDataEmitted":false,"payloadsEmitted":false,"pathsEmitted":false}},"error":null}
```

| Command | `data` members |
| --- | --- |
| `status` | `runId`, `runIdHash`, `journalApiVersion`, `status`, `terminal`, `eventCount`, `lastSequence`, `graphRevision`, `firstEventTimestamp`, `lastEventTimestamp`, `resumeCount`, `pauseCount`, `observedNodeCount`, `redaction` |
| `inspect` | `runId`, `runIdHash`, `journalApiVersion`, `status`, `terminal`, `eventCount`, `lastSequence`, `graphRevision`, `eventTypeCounts`, `observedNodes`, `observedEdges`, `redaction` |
| `logs` | `runId`, `runIdHash`, `journalApiVersion`, `eventCount`, `fromSequence`, `limit`, `returned`, `truncated`, `nextSequence`, `events`, `redaction` |

`observedNodes` entries carry `nodeId`, `eventCount`, `firstSequence`,
`lastSequence`, `observedMaxAttempt`, `scheduled`, `started`, `succeeded`,
`attemptFailures`, `retries`, and `settledWithoutAttempt`. `observedEdges`
entries carry `edgeId`, `eventCount`, `firstSequence`, and `lastSequence`. Both
lists are ordered by Unicode code point. `events` entries carry `sequence`,
`type`, `timestamp`, `nodeId`, `edgeId`, `attempt`, and `redacted`.

The word *observed* is literal: these are counts of records present in the
journal, not a claim about the graph. A node the history never mentions is
absent from `observedNodes` rather than reported as pending.

### Operational error envelopes

| Code | Exit | `error` members beyond `code`/`message` |
| --- | ---: | --- |
| `GECLI_USAGE` | `2` | — |
| `GECLI_RUN_ID_INVALID` | `2` | — (the rejected identifier is never echoed) |
| `GECLI_STORE_UNREADABLE` | `2` | `runId` |
| `GECLI_HISTORY_UNREADABLE` | `2` | `runId` |
| `GECLI_HISTORY_TOO_LARGE` | `2` | `runId` |
| `GECLI_RUN_NOT_FOUND` | `4` | `runId` |
| `GECLI_HISTORY_MALFORMED` | `5` | `runId`, `record` (one-based record ordinal, or `null` for a file-level fault) |
| `GECLI_UNSUPPORTED_CAPABILITY` | `6` | `runId`, `capability` |

A malformed journal is never partially projected. Records are validated against
the frozen envelope of the contract the layout declares — closed property set,
required members, `apiVersion`, an event type in that contract's vocabulary,
RFC 3339 timestamp, matching `runId`, sequence equal to the record index, and an
object `data` member — and the first violation fails the whole command. A
v1alpha2 record additionally requires 64-hex `payloadHash` and
`capturePolicyHash` members, `redacted: false`, and a `payloadDisposition` of
`metadata-only` or `protected-ref`: an inline disposition or `redacted: true` is
unrepresentable in a protected journal, so a record claiming either is refused
rather than projected. Event types are contract-specific — a `RunPaused` record
is valid v1alpha1 and malformed in a v1alpha2 journal.

### Unimplemented durable operations

The plan's command matrix is larger than this runtime. Rather than ship a stub
that appears to work, these commands refuse before touching the durable store,
so they neither read nor append:

| Command | `capability` | Why it cannot be honest today |
| --- | --- | --- |
| `cancel` | `durable.run-cancellation` | Neither journal contract has a cancellation-request record, and a terminal `RunCancelled` record must carry a scheduler-reconstructed run result covering every node. Cancelling a live run also needs an out-of-band control channel that does not exist. |
| `resume` | `durable.run-resume` | Resuming needs a run lease and a node executor registry. The CLI never executes graph nodes, so a CLI resume would durably fail every remaining node. |
| `replay` | `durable.run-replay` | Durable *graph-run* replay is not implemented. The standalone bounded-cycle controller has its own replay, which is a different object and is not reachable from this command. |
| `fork` | `durable.run-fork` | Durable *graph-run* forking is not implemented, for the same reason. |
| `retry` | `durable.node-retry` | Durable node-level retry scheduling is not implemented. |

Usage validation still runs first, so a malformed invocation of one of these
commands exits `2` before the capability refusal at `6`.

### Redaction boundary

`spec/redaction-semantics.md` classifies `cli-json` and `cli-diagnostic` as
capture sinks. The operational commands honour that with one simple, checkable
rule: **the CLI never reads `event.data`.** Graph input, bound node input, node
output, run results, payload hashes, activity keys, implementation hashes, and
resolved filesystem paths therefore cannot reach stdout or stderr. Only the
closed envelope-metadata allowlist above is emitted, and every envelope repeats
the `redaction` marker naming the sink.

### Cross-language parity

The two CLIs must emit byte-identical stdout, byte-identical stderr, and the
same exit code for the same input. `node tools/conformance/run.mjs` enforces
that over `tools/conformance/cli-operations.case.json`, a shared corpus of
authentic durable journals in both contracts — including protected v1alpha2
histories the real durable scheduler wrote — plus adversarial malformed ones.
Each half drives its own native CLI, materializes its own store, and reports its
own constants; the corpus contains no expected output for either side to copy.
The join also compares the store listing before and after every invocation, so a
read command that created so much as a lock file would fail it.

## Safe initialization

`init` accepts only a missing target or an existing empty, non-symlink
directory. The final file uses exclusive create/no-follow behavior and the
directory is rechecked around the write. Cleanup is limited to the exact inode
and empty directories created by that invocation—there is no recursive delete.
Use `--dry-run` to execute validation and safety checks without writing.

Implementation-specific package notes are in the
[TypeScript CLI README](../packages/cli/README.md) and
[Python README](../python/README.md).
