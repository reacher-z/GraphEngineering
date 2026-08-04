# Launching Pattern 10 — scheduled ecosystem scan (reduced form)

The bundle itself lives in
[`examples/patterns/ecosystem-scan/`](../../examples/patterns/ecosystem-scan/README.md).
This page is the operator-facing half: how to launch it from a shell, from an
SDK, from Claude Code, from Codex, and over MCP; what a real feed provider
would require; and what to collect when it misbehaves.

Everything below runs against the deterministic mock adapter. No launch path
in this document contacts a feed or a provider, none of them needs a
credential, and — despite the pattern's name — none of them is scheduled.
There is no scheduler, no schedule identity and no overlap lease in this
repository; every run starts because you start it.

## Shell

Build the packages the runners import, then run each lane:

```bash
corepack pnpm --filter @graph-engineering/core build \
  && corepack pnpm --filter @graph-engineering/patterns build \
  && corepack pnpm --filter @graph-engineering/persistence build \
  && corepack pnpm --filter @graph-engineering/adapters build \
  && corepack pnpm --filter @graph-engineering/runtime build

# deterministic mock, end to end
node examples/patterns/ecosystem-scan/run.mjs
uv run --project python python examples/patterns/ecosystem-scan/run.py

# injected failure, crash, resume, terminal replay
node examples/patterns/ecosystem-scan/resume.mjs
uv run --project python python examples/patterns/ecosystem-scan/resume.py
```

Each runner writes one JSON report to stdout and nothing else. Every assertion
runs before the report is printed, so output at all means the run held.

Exit codes are the plain Node and Python ones: `0` for a run whose assertions
all held, non-zero with a stack trace otherwise.

## CLI

The repository CLI operates on Graph IR documents, so it can validate and
inspect this bundle's canonical graph directly:

```bash
uv run --project python graph validate examples/patterns/ecosystem-scan/ecosystem-scan.graph.json
uv run --project python graph validate examples/patterns/ecosystem-scan/ecosystem-scan.graph.yaml --input-format yaml
uv run --project python graph plan examples/patterns/ecosystem-scan/ecosystem-scan.graph.json
uv run --project python graph visualize examples/patterns/ecosystem-scan/ecosystem-scan.graph.json
```

Both documents validate to the same SHA-256,
`105772b922af64758407ad71f4e47cb35964609728861ec0bf8baed343388303`.

The CLI cannot execute this bundle. `graph resume`, `replay`, `fork`, `retry`
and `cancel` all fail closed with exit code 6 — durable run leases and
CLI-side node executors do not exist. The two example runners are the only way
to *execute* the pattern. See [`docs/CLI.md`](../CLI.md).

## SDK — TypeScript

```ts
import { ecosystemScan } from "@graph-engineering/patterns";
import { runGraph } from "@graph-engineering/runtime";

const graph = ecosystemScan({
  inventoryVersion: "2026-01",
  sources: [
    { key: "advisories", feed: "advisories://example.invalid/security" },
    { key: "registry", feed: "registry://example.invalid/packages" },
    { key: "releases", feed: "releases://example.invalid/graph-engineering" },
  ],
});

const result = await runGraph(
  graph,
  { inventoryVersion, window },
  { nodeExecutors, concurrency: 3 },
);
```

`nodeExecutors` needs one entry per node: `inventory`, `fetch-<key>` for each
source, `normalize`, and `digest`. The bundle's own wiring is in
[`bundle.mjs`](../../examples/patterns/ecosystem-scan/bundle.mjs) and is
importable as a starting point. Note that `digest` receives its input keyed
under the upstream node id (`input.normalize`) because the barrier feeds it
through a single un-ported edge.

For a durable run, use `startDurableGraphRun` / `resumeDurableGraphRun` and
supply payload protection. A durable run without it fails closed with
`PAYLOAD_PROTECTION_REQUIRED` before the first event and the first executor
call — that is deliberate, not a configuration bug.

## SDK — Python

```python
from graph_engineering import compile_graph, run_graph
from graph_engineering.patterns import ecosystem_scan

document = ecosystem_scan(
    inventory_version="2026-01",
    sources=[
        {"key": "advisories", "feed": "advisories://example.invalid/security"},
        {"key": "registry", "feed": "registry://example.invalid/packages"},
        {"key": "releases", "feed": "releases://example.invalid/graph-engineering"},
    ],
)
graph = compile_graph(document)
result = await run_graph(
    graph, {"inventoryVersion": inventory_version, "window": window},
    handlers, max_concurrency=3,
)
```

The Python constructor produces the same canonical document as the TypeScript
one; both runners assert that against the committed graph before doing
anything else.

## Claude Code

There is no Claude Code plugin, hook or slash command for this bundle. What
works today is running it as an ordinary command from a Claude Code session:

```
Run node examples/patterns/ecosystem-scan/run.mjs and show me the digest.
```

Then, to see the recovery path:

```
Run node examples/patterns/ecosystem-scan/resume.mjs and tell me whether the
committed fetch was re-fetched.
```

The answer is in the report as `crashAndResume.committedFetchReExecuted`, and
the assertion behind it is a `fetch-advisories` executor that throws if it is
ever invoked after the resume.

To adapt the bundle rather than run it, point the session at
[`bundle.mjs`](../../examples/patterns/ecosystem-scan/bundle.mjs) — the
normalize and ranking semantics, the adapter wiring and the overlap gate are
all there, and the fixtures under
[`fixtures/`](../../examples/patterns/ecosystem-scan/fixtures/sources.json)
are what defines "what the feeds returned".

## Codex

Same shape, no bundle-specific integration. Give the task the two commands and
the fixture path:

```
Repo: GraphEngineering. Run:
  node examples/patterns/ecosystem-scan/run.mjs
  uv run --project python python examples/patterns/ecosystem-scan/run.py
Both must print a digest and exit 0. The scan corpus is
examples/patterns/ecosystem-scan/fixtures/sources.json; changing it changes
the expected digest, which lives in fixtures/expected-run.json.
```

Any change to the corpus must be reflected in `fixtures/expected-run.json` and
`fixtures/expected-events.json`, or both lanes fail — which is the point of
keeping the expectations in files.

## MCP

`@graph-engineering/mcp-server` is a read-only, local stdio MCP server that
registers exactly three tools — `graph_validate`, `graph_plan` and
`graph_get_schema` — all marked `readOnlyHint: true`. None of them executes a
graph, and there is no ecosystem-scan-specific tool. What an MCP client can do
with this bundle is pass the canonical graph document to `graph_validate` (it
returns the same canonical hash the CLI prints) or to `graph_plan` (it returns
the four topological layers and the maximum parallel width of 3).

If you need the bundle to run from an MCP client, the honest path is a shell
tool invoking the two runner commands above; nothing in the MCP surface makes
that safer or more observable than running them directly.

## Real-provider setup

Nothing in this repository has ever contacted a feed, and there is no feed
client to configure. `mock`, `http` and `shell` are the adapter kinds that
exist; the `shell` adapter refuses execution outright because no isolation
provider exists. Swapping real feeds in is therefore not a configuration
change — it is new code. What it would require, at minimum:

1. **An adapter descriptor per feed kind**, declaring its capabilities,
   bounds, retry policy, circuit policy and allowed provider metrics. Start
   from [`mock-adapter.descriptor.json`](../../examples/patterns/ecosystem-scan/mock-adapter.descriptor.json)
   and remove `fault-injection`, which is restricted to deterministic-mock
   evidence.
2. **An adapter implementing the same boundary the mock already satisfies** —
   preflight refusal before dispatch, a normalized error envelope, usage that
   never exceeds what the descriptor authorizes, and a conservative usage
   record wherever zero external effect cannot be asserted.
3. **Pagination, rate-limit and huge-feed handling.** The master-plan cases
   (pagination loops, rate limiting, huge feeds, stale caches) are exactly the
   ones a real feed adapter has to own; nothing here handles them.
4. **A trusted clock policy.** This bundle compares fixture dates
   lexicographically. Real feeds report future, wrong and skewed dates; a real
   scan has to decide what "now" is and what to do with a date that claims to
   be after it.
5. **Schedule identity and an overlap lease**, if the scan is to actually be
   scheduled. Nothing in this repository provides either.
6. **Credential handling that is not in the graph.** The Graph IR carries no
   secret and must not start.
7. **An egress policy you enforce yourself.** The declared `egressAllowlist`
   in the bundle manifest is documentation; no component enforces it.
8. **A separate CI lane.** A real-feed run is not deterministic, must not gate
   the mock lane, and must not run on pull requests from forks.

Until those exist, treat "real provider" as unimplemented rather than
unconfigured.

## Operational runbook

### What a healthy run looks like

- `parallelRun.maxObservedConcurrency` is `3`. Anything less means the fetches
  did not overlap.
- `parallelRun.mockDispatches` is `3` — one dispatch per fetch.
- `durableRun.committedEvents` is `28`, and the sequence equals
  `fixtures/expected-events.json`'s `nominal` array.
- The digest contains three ranked entries with dense ranks from 1, one
  version conflict (`item-core-release`, resolved to `2.1.0`), two duplicate
  item ids, and one dropped out-of-window item.

### Observability queries

There is no metrics or tracing backend in this repository. "Queries" here
means projections over the durable journal, which is the only durable record a
run leaves. Both runners use the same projection:

```js
// [sequence, type, nodeId] for every committed event
for await (const event of journal.read(runId)) {
  rows.push([event.sequence, event.type, event.nodeId ?? null]);
}
```

Useful projections over that list:

| Question | Projection |
| --- | --- |
| Did the fetches overlap? | Every `NodeStarted` for a `fetch-*` node appears before the first `NodeSucceeded` for any of them. |
| Did a fetch get retried? | A `NodeAttemptFailed` followed by a `NodeRetried` for the same node. |
| Was this run resumed? | A `RunResumed` event exists. |
| Was a committed fetch re-run after resume? | No event for that node appears after the `RunResumed`. |
| Did ranking wait for every source? | `NodeStarted` for `digest` appears only after `NodeSucceeded` for `normalize`, which appears only after every fetch's `NodeSucceeded`. |
| How long did the barrier wait? | The gap between the last fetch `NodeSucceeded` and `NodeStarted` for `normalize`, in sequence numbers — the runners render this as the trace. |

The trace both runners print is an *event-order* chart, not a wall-clock one.
The scale is the journal sequence number, which is reproducible; a duration
chart would not be.

### Common failures

| Symptom | Cause | Action |
| --- | --- | --- |
| `PAYLOAD_PROTECTION_REQUIRED` | A durable run was started without payload protection. | Configure protection. This is fail-closed behaviour, not a bug. |
| `PreparedSinkWriteMisuse` | A prepared write was handed to a different journal instance than the one that minted it — typically a delegating journal proxy. | Subclass the journal instead of wrapping it. The Python resume demo documents this exact case. |
| `IN_DOUBT_SIDE_EFFECT` on resume | An interrupted node declares a side effect other than `none`/`idempotent`. | The runtime will not guess. Decide manually; the pattern's fetches declare `none` precisely to stay resumable. |
| `GRAPH_HASH_MISMATCH` on resume | The graph changed between start and resume. | Resume the original graph; a changed graph is a new run. |
| Runner fails on a fixture comparison | The corpus, the normalize/ranking semantics or the scheduler's event ordering changed. | Diff the actual against `fixtures/expected-events.json`. If the change is intended, regenerate both fixtures and re-run both lanes. |
| `maxObservedConcurrency` below 3 | Concurrency was capped below the source count, or the executors are not actually async. | Check `concurrency` / `max_concurrency` and the graph's `maxConcurrency` policy. |
| No digest at all after a permanent fetch failure | The normalize barrier is all-success; a permanently failed source means the barrier never fires. | Expected behaviour today. Partial retention needs integrated barrier policies, which do not exist. |

### Rollback

The bundle has no deployed state. Rolling back means `git checkout` of the
bundle directory plus `packages/patterns/src/ecosystem-scan.ts` and
`python/src/graph_engineering/patterns/ecosystem_scan.py`. There is no
migration and no store to revert; the example journals are in memory and
vanish with the process.

### Support bundle

There is no support-bundle command. Collect by hand:

- the full stdout of the failing runner, and its exit code;
- the committed event projection (`[sequence, type, nodeId]`) for the failing
  run id;
- `ecosystem-scan.graph.json` and its canonical hash;
- `fixtures/sources.json`, `fixtures/expected-run.json` and
  `fixtures/expected-events.json` as they exist in your checkout;
- `node --version`, `uv run --project python python --version`, and the
  commit.

Never include key material or a protected payload store; the journal is
deliberately unreadable without the key, and that property is only useful if
it is preserved when you ask for help.

## Security and data-quality notes

The barrier body is where this pattern's trust decisions live, and it treats
every feed as data, never as instruction.

- **Duplicate syndication.** The same item reported by two sources is one
  entry with two sightings, keyed by `itemId` — corroboration is visible and
  is not double-counted. The corpus contains such an item
  (`item-cli-release`).
- **Version disagreement.** Two sources reporting different versions of the
  same item does not become a silent pick. The highest version wins by a total
  deterministic order, the winner's date and link become canonical, and both
  reported positions are preserved in `versionConflicts`. The corpus contains
  such an item (`item-core-release`).
- **Out-of-window dates.** An item whose fixture publication date falls
  outside the scan window is dropped and the drop is reported. This is the
  entire extent of date validation: dates are compared as ISO-8601 strings,
  no clock is read, and a source reporting a plausible-but-wrong in-window
  date is not detected.
- **What is not defended.** No impact classification, no cross-source content
  verification, no defence against a compromised *executor* — there is no
  isolation boundary between an executor and the process. A malicious node
  executor can do whatever the process can do. And because nothing enforces a
  rate or cost bound, a real (non-mock) adapter wired into this graph would be
  bounded only by `retry.maxAttempts` and `maxTotalAttempts`.

## Version and known limitations

Tested against the versions recorded in
[`manifest.json`](../../examples/patterns/ecosystem-scan/manifest.json)
(`testedVersions`). The limitations that matter most before you build on this:

- Nothing is scheduled: no schedule identity, no overlap lease, no
  scheduled-run provenance. Concurrent runs are not fenced.
- Declared budgets and permissions are documentation; nothing enforces them,
  and there is no rate limiting.
- A permanently failed source yields no digest at all — the barrier is
  all-success, so partial-source retention, quorum and late-source behaviour
  are unavailable.
- No impact/relevance classification; ranking is fixture publication date with
  itemId tie-break.
- No retained last-success metadata between runs; everything is in-memory.
- Timeout, cancellation-during-ranking and replay/fork are not demonstrated.
- No CI job runs the bundle's runners, and the bundle has not been
  independently reviewed.
