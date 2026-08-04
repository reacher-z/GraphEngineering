# Launching Pattern 02 — cited deep research (reduced form)

The bundle itself lives in
[`examples/patterns/cited-research/`](../../examples/patterns/cited-research/README.md).
This page is the operator-facing half: how to launch it from a shell, from an
SDK, from Claude Code, from Codex, and over MCP; what a real research provider
would require; and what to collect when it misbehaves.

Everything below runs against the deterministic mock adapter. No launch path
in this document contacts a provider or performs research, none of them needs
a credential, and none of them fans out per claim — the skeptic stage is a
fixed three-slot construction-time constant, because dynamic per-claim
fan-out needs the `dynamic-graph-patch` runtime capability, which every
runtime in this repository refuses.

## Shell

Build the packages the runners import, then run each lane:

```bash
corepack pnpm --filter @graph-engineering/core build \
  && corepack pnpm --filter @graph-engineering/patterns build \
  && corepack pnpm --filter @graph-engineering/persistence build \
  && corepack pnpm --filter @graph-engineering/adapters build \
  && corepack pnpm --filter @graph-engineering/runtime build

# deterministic mock, end to end
node examples/patterns/cited-research/run.mjs
uv run --project python python examples/patterns/cited-research/run.py

# injected failure, crash, resume, terminal replay
node examples/patterns/cited-research/resume.mjs
uv run --project python python examples/patterns/cited-research/resume.py
```

Each runner writes one JSON report to stdout and nothing else. Every assertion
runs before the report is printed, so output at all means the run held.

Exit codes are the plain Node and Python ones: `0` for a run whose assertions
all held, non-zero with a stack trace otherwise.

## CLI

The repository CLI operates on Graph IR documents, so it can validate and
inspect this bundle's canonical graph directly:

```bash
uv run --project python graph validate examples/patterns/cited-research/cited-research.graph.json
uv run --project python graph validate examples/patterns/cited-research/cited-research.graph.yaml --input-format yaml
uv run --project python graph plan examples/patterns/cited-research/cited-research.graph.json
uv run --project python graph visualize examples/patterns/cited-research/cited-research.graph.json
```

Both documents validate to the same SHA-256,
`7d9e60a3811f0518a0c3e123c8109ee0dd5221dbbca83668d90acc347f4ae6c2`.

The CLI cannot execute this bundle. `graph resume`, `replay`, `fork`, `retry`
and `cancel` all fail closed with exit code 6 — durable run leases and
CLI-side node executors do not exist. The two example runners are the only way
to *execute* the pattern. See [`docs/CLI.md`](../CLI.md).

## SDK — TypeScript

```ts
import { citedResearch, claimId } from "@graph-engineering/patterns";
import { runGraph } from "@graph-engineering/runtime";

const graph = citedResearch({
  skepticSlots: 3,
  sources: [
    { key: "changelog", role: "release history and changelog entries" },
    { key: "docs", role: "reference documentation and manifests" },
    { key: "interviews", role: "practitioner interview notes" },
  ],
});

const result = await runGraph(graph, { question }, { nodeExecutors, concurrency: 3 });
```

`nodeExecutors` needs one entry per node: `scope`, `source-<key>` for each
source, `claims`, `skeptic-<n>` for each slot, and `adjudicate`. The bundle's
own wiring is in
[`bundle.mjs`](../../examples/patterns/cited-research/bundle.mjs) and is
importable as a starting point. Two shapes are worth knowing:

- each skeptic receives its input keyed under the upstream node id
  (`input.claims`) because the claims barrier feeds it through a single
  un-ported edge, and
- `adjudicate` is a barrier with four named ports — `skeptic-1..3` plus
  `claims` — so the coverage gate sees uncited claims that hold no skeptic
  slot.

`claimId(text)` is the stable claim-identity rule (first 12 hex characters of
SHA-256 over the exact text). Use it rather than re-implementing the hash: the
bundle's adjudicator recomputes every reviewed claim's id from its text, and a
drifted rule fails the run.

For a durable run, use `startDurableGraphRun` / `resumeDurableGraphRun` and
supply payload protection. A durable run without it fails closed with
`PAYLOAD_PROTECTION_REQUIRED` before the first event and the first executor
call — that is deliberate, not a configuration bug.

## SDK — Python

```python
from graph_engineering import compile_graph, run_graph
from graph_engineering.patterns import cited_research, claim_id

document = cited_research(
    skeptic_slots=3,
    sources=[
        {"key": "changelog", "role": "release history and changelog entries"},
        {"key": "docs", "role": "reference documentation and manifests"},
        {"key": "interviews", "role": "practitioner interview notes"},
    ],
)
graph = compile_graph(document)
result = await run_graph(graph, {"question": question}, handlers, max_concurrency=3)
```

The Python constructor produces the same canonical document as the TypeScript
one, and `claim_id` is the same hash rule as `claimId` — both language test
suites pin identical literals. Both runners assert constructor parity against
the committed graph before doing anything else.

## Claude Code

There is no Claude Code plugin, hook or slash command for this bundle. What
works today is running it as an ordinary command from a Claude Code session:

```
Run node examples/patterns/cited-research/run.mjs and show me the evidence table.
```

Then, to see the recovery path:

```
Run node examples/patterns/cited-research/resume.mjs and tell me whether the
committed source was re-run.
```

The answer is in the report as `crashAndResume.committedSourceReExecuted`, and
the assertion behind it is a `source-changelog` executor that throws if it is
ever invoked after the resume.

To adapt the bundle rather than run it, point the session at
[`bundle.mjs`](../../examples/patterns/cited-research/bundle.mjs) — the claim
extraction, slot assignment, verdict rules, adapter wiring and overlap gates
are all there, and the fixtures under
[`fixtures/`](../../examples/patterns/cited-research/fixtures/sources.json)
are what defines "what the sources reported and what the skeptics argued".

## Codex

Same shape, no bundle-specific integration. Give the task the two commands and
the fixture path:

```
Repo: GraphEngineering. Run:
  node examples/patterns/cited-research/run.mjs
  uv run --project python python examples/patterns/cited-research/run.py
Both must print an evidence table and exit 0. The research corpus is
examples/patterns/cited-research/fixtures/sources.json; changing it changes
the expected verdicts, which live in fixtures/expected-run.json.
```

Any change to the corpus must be reflected in `fixtures/expected-run.json` and
`fixtures/expected-events.json`, or both lanes fail — which is the point of
keeping the expectations in files. Remember that claim ids are hashes of the
exact claim text: editing one character of a claim re-keys it everywhere.

## MCP

`@graph-engineering/mcp-server` is a read-only, local stdio MCP server that
registers exactly three tools — `graph_validate`, `graph_plan` and
`graph_get_schema` — all marked `readOnlyHint: true`. None of them executes a
graph, and there is no cited-research-specific tool. What an MCP client can do
with this bundle is pass the canonical graph document to `graph_validate` (it
returns the same canonical hash the CLI prints) or to `graph_plan` (it returns
the five topological layers and the maximum parallel width of 3).

If you need the bundle to run from an MCP client, the honest path is a shell
tool invoking the two runner commands above; nothing in the MCP surface makes
that safer or more observable than running them directly.

## Real-provider setup

Nothing in this repository has ever performed research, and there is no
research client to configure. `mock`, `http` and `shell` are the adapter kinds
that exist; the `shell` adapter refuses execution outright because no
isolation provider exists. Swapping a real provider in is therefore not a
configuration change — it is new code. What it would require, at minimum:

1. **An adapter descriptor per provider**, declaring its capabilities, bounds,
   retry policy, circuit policy and allowed provider metrics. Start from
   [`mock-adapter.descriptor.json`](../../examples/patterns/cited-research/mock-adapter.descriptor.json)
   and remove `fault-injection`, which is restricted to deterministic-mock
   evidence.
2. **An adapter implementing the same boundary the mock already satisfies** —
   preflight refusal before dispatch, a normalized error envelope, usage that
   never exceeds what the descriptor authorizes, and a conservative usage
   record wherever zero external effect cannot be asserted.
3. **Real claim extraction and real skepticism.** In this bundle both are
   fixture data. A real deployment needs model prompts (or human review) for
   proposing claims with citations and for adversarial review, plus a policy
   for what happens when extraction returns more cited claims than the static
   slots can review — today that is a loud failure.
4. **Citation verification that dereferences.** The coverage gate here checks
   that a citation names a source item that exists in the corpus. A real
   deployment has to fetch and check the cited material, handle dead links,
   and decide what a stale citation means.
5. **Dynamic fan-out, if you need one skeptic per claim.** That requires the
   `dynamic-graph-patch` capability behind `maxDynamicNodes`, which no runtime
   in this repository implements; until then the slot count is a static bound.
6. **Credential handling that is not in the graph.** The Graph IR carries no
   secret and must not start.
7. **An egress policy you enforce yourself.** The declared `egressAllowlist`
   in the bundle manifest is documentation; no component enforces it.
8. **A separate CI lane.** A real-provider run is not deterministic, must not
   gate the mock lane, and must not run on pull requests from forks.

Until those exist, treat "real provider" as unimplemented rather than
unconfigured.

## Operational runbook

### What a healthy run looks like

- `parallelRun.maxObservedConcurrency` is `3`. Anything less means the lanes
  did not overlap.
- `parallelRun.mockDispatches` is `6` — one dispatch per source and per
  skeptic.
- `durableRun.committedEvents` is `43`, and the sequence equals
  `fixtures/expected-events.json`'s `nominal` array.
- The evidence table contains four rows, one per verdict kind: one
  `supported` (two distinct citing sources), one `contradicted` (with the
  counter-evidence resolved against a corpus item), one `rejected`
  (`citation-coverage: cites no source item`), one `insufficient-evidence`
  (single-source, no contradiction).
- Every row's `claimId` re-derives from its `text` via `claimId`/`claim_id`.

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
| Did the sources overlap? | Every `NodeStarted` for a `source-*` node appears before the first `NodeSucceeded` for any of them. |
| Did the skeptics overlap? | Same projection over the `skeptic-*` nodes. |
| Did a source get retried? | A `NodeAttemptFailed` followed by a `NodeRetried` for the same node. |
| Was this run resumed? | A `RunResumed` event exists. |
| Was a committed source re-run after resume? | No event for that node appears after the `RunResumed`. |
| Did review wait for every source? | `NodeStarted` for any `skeptic-*` appears only after `NodeSucceeded` for `claims`, which appears only after every source's `NodeSucceeded`. |
| Did adjudication wait for every skeptic? | `NodeStarted` for `adjudicate` appears only after every skeptic's `NodeSucceeded`. |
| How long did a barrier wait? | The gap between the last upstream `NodeSucceeded` and the barrier's `NodeStarted`, in sequence numbers — the runners render this as the trace. |

The trace both runners print is an *event-order* chart, not a wall-clock one.
The scale is the journal sequence number, which is reproducible; a duration
chart would not be.

### Common failures

| Symptom | Cause | Action |
| --- | --- | --- |
| `PAYLOAD_PROTECTION_REQUIRED` | A durable run was started without payload protection. | Configure protection. This is fail-closed behaviour, not a bug. |
| `PreparedSinkWriteMisuse` | A prepared write was handed to a different journal instance than the one that minted it — typically a delegating journal proxy. | Subclass the journal instead of wrapping it. The Python resume demo documents this exact case. |
| `IN_DOUBT_SIDE_EFFECT` on resume | An interrupted node declares a side effect other than `none`/`idempotent`. | The runtime will not guess. Decide manually; the pattern's agent nodes declare `none` precisely to stay resumable. |
| `GRAPH_HASH_MISMATCH` on resume | The graph changed between start and resume. | Resume the original graph; a changed graph is a new run. |
| `cited claims exceed the … static skeptic slots` | The corpus proposes more cited claims than the construction-time slot count. | Expected behaviour today: the failure is loud, not a truncation. Raise `skepticSlots` (1..8) and regenerate the bundle, or reduce the corpus. |
| `a skeptic must review the claim assigned to its slot` | A skeptic script drifted from the slot assignment, or a claim text was edited without re-keying the skeptic fixtures. | Claim ids are hashes of exact text. Recompute the slot order (cited claims sorted by claim id) and fix `fixtures/sources.json`'s `skeptics` section. |
| Runner fails on a fixture comparison | The corpus, the extraction/adjudication semantics or the scheduler's event ordering changed. | Diff the actual against `fixtures/expected-events.json` / `expected-run.json`. If the change is intended, regenerate both fixtures and re-run both lanes. |
| `maxObservedConcurrency` below 3 | Concurrency was capped below the lane count, or the executors are not actually async. | Check `concurrency` / `max_concurrency` and the graph's `maxConcurrency` policy. |
| No verdicts at all after a permanent failure | Both barriers are all-success; a permanently failed source or skeptic means the downstream barrier never fires. | Expected behaviour today. Partial adjudication needs integrated barrier policies, which do not exist. |

### Rollback

The bundle has no deployed state. Rolling back means `git checkout` of the
bundle directory plus `packages/patterns/src/cited-research.ts` and
`python/src/graph_engineering/patterns/cited_research.py`. There is no
migration and no store to revert; the example journals are in memory and
vanish with the process.

### Support bundle

There is no support-bundle command. Collect by hand:

- the full stdout of the failing runner, and its exit code;
- the committed event projection (`[sequence, type, nodeId]`) for the failing
  run id;
- `cited-research.graph.json` and its canonical hash;
- `fixtures/sources.json`, `fixtures/expected-run.json` and
  `fixtures/expected-events.json` as they exist in your checkout;
- `node --version`, `uv run --project python python --version`, and the
  commit.

Never include key material or a protected payload store; the journal is
deliberately unreadable without the key, and that property is only useful if
it is preserved when you ask for help.

## Security and data-quality notes

The two barrier bodies are where this pattern's trust decisions live, and
they treat every source and every skeptic as data, never as instruction.

- **Stable claim identity.** A claim id is the first 12 hex characters of
  SHA-256 over the exact claim text, computed identically in both languages
  and re-derived at adjudication time. Corroboration therefore requires
  byte-identical text; a paraphrase is a different claim. That prevents
  silent claim merging but provides no semantic deduplication.
- **Citation coverage is existence, not truth.** The gate rejects a claim
  whose citations resolve to nothing, and the corpus contains such a claim.
  A citation that resolves to a real but irrelevant item would pass; nothing
  reads the cited content.
- **Contradictions are preserved.** A contradicted claim is not deleted — it
  stays in the evidence table with the skeptic's counter-evidence, which must
  itself resolve to a catalogued source item or the run fails.
- **Skeptic integrity is enforced structurally.** Slot, claim id and text
  hash are cross-checked; a skeptic reviewing the wrong claim fails the run.
  The *content* of a skeptic's finding, however, is fixture data — no runtime
  property makes it genuinely adversarial.
- **What is not defended.** No semantic verification, no dereferenced
  citations, no defence against a compromised *executor* — there is no
  isolation boundary between an executor and the process. And because nothing
  enforces a rate or cost bound, a real (non-mock) adapter wired into this
  graph would be bounded only by `retry.maxAttempts` and `maxTotalAttempts`.

## Version and known limitations

Tested against the versions recorded in
[`manifest.json`](../../examples/patterns/cited-research/manifest.json)
(`testedVersions`). The limitations that matter most before you build on this:

- No per-claim fan-out: the skeptic stage is a static three-slot bound, and
  `dynamic-graph-patch` is refused by every runtime. More cited claims than
  slots is a loud failure.
- Skeptics are `agent` nodes because the `validator` kind is refused; no
  verifier semantics are claimed.
- Both barriers are all-success joins — a permanently failed source or
  skeptic yields no verdicts at all; quorum and deadline behaviour need
  integrated barrier policies, which do not exist.
- Declared budgets and permissions are documentation; nothing enforces them,
  and there is no rate limiting.
- Verdicts are corroboration accounting over fixtures, not truth; claim ids
  are exact-text hashes with no semantic deduplication.
- No retained state between runs; everything is in-memory.
- Timeout, cancellation-during-adjudication and replay/fork are not
  demonstrated.
- The bundle has not been independently reviewed, and no CI job runs the
  runners from packed artifacts (they run from the workspace build).
