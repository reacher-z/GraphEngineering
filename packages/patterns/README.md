# `@graph-engineering/patterns`

> **Runtime boundary:** `routedBranches` emits the fixed, versioned
> `RouteEquals` annotation executed by the current TypeScript and Python
> schedulers. `loopUntilDry` is **not executable on either scheduler**: its
> `LoopContinue`, `LoopDryVerdict`, and `LoopVerdictAtBound` annotations are not
> `RouteEquals`, so both runtimes refuse the whole graph with
> `UNSUPPORTED_EDGE_CONDITION` and zero attempts. It is a blueprint, not a
> runnable graph.

Zero-side-effect TypeScript constructors for deterministic, canonical Graph
Engineering Graph IR. Every result is detached from caller input, recursively
frozen, finite portable JSON, and accepted by `@graph-engineering/core` before it
is returned.

```ts
import {
  diamond,
  loopUntilDry,
  researchDiamond,
  routedBranches,
  verifiedFanout,
} from "@graph-engineering/patterns";
```

`researchDiamond` is the Pattern 01 bundle constructor and the only one with a
native Python peer, `graph_engineering.patterns.research_diamond`; both languages
are required to produce the same canonical document. The other four constructors
are TypeScript-only.

## Constructors

### `diamond`

Builds `split → workers → merge`. `split` is the only entrypoint. Every worker
receives the split result; every worker result reaches a unique merge input port
named by its key. The named graph output points to `merge`.

```ts
const graph = diamond({
  metadata: { name: "research-diamond", version: "1.0.0" },
  split,
  workers: [
    { key: "code", node: researchCode },
    { key: "docs", node: researchDocs },
  ],
  merge: synthesize,
});
```

### `researchDiamond`

Builds the Pattern 01 multi-source research diamond: `scope` fans out to one
`source-<key>` node per source, and every source result reaches a unique
`synthesize` barrier port named by its key. Unlike the other constructors it
owns the node identities, so two callers who describe the same sources get the
same graph.

```ts
const graph = researchDiamond({
  sources: [
    { key: "code", role: "Find executable examples and implementation constraints" },
    { key: "docs", role: "Find primary documentation and return cited facts" },
    { key: "web", role: "Find third-party reports and dated claims" },
  ],
});
```

Optional fields are `name` (default `research-diamond`), `version` (default
`1.0.0`) and `maxAttemptsPerSource` (default `2`, range `1..8`). Source keys are
normalized by Unicode code point, so source order never changes the graph or its
hash. Each source declares `sideEffects: "none"` and `retry.maxAttempts`, which
together are what let an interrupted attempt be re-driven on a durable resume
rather than refused as in-doubt. Policies are derived: `maxConcurrency` and
`maxFanOut` equal the source count, `maxDepth` is `3`, and `maxTotalAttempts` is
`2 + sources × maxAttemptsPerSource`.

The constructor declares no budget, permission, network policy or isolation.
Nothing in this repository enforces any of those, and emitting them would make
an ungoverned run read as a governed one; the bundle manifest states them as
documented intent instead.

The runnable bundle — canonical JSON and YAML, fixtures, a deterministic mock
end-to-end run and an injected-failure-and-resume demonstration in both
languages — is in
[`examples/patterns/research-diamond/`](../../examples/patterns/research-diamond/README.md).

### `routedBranches`

Builds `classify → branches → merge`. Classifier-to-branch edges carry this
package-owned annotation; callers cannot replace or extend it:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
  "kind": "RouteEquals",
  "routeKey": "security"
}
```

Branch outputs reach unique merge ports. Metadata declares required capability
`edge-condition-routing/v1alpha1`. Both native schedulers execute only selected
branches, settle inactive paths without attempts, and bind the merge from active
branch outputs. The constructor lowers an empty legacy classifier config to an
exact direct single-route policy whose ordered `allowedRoutes` match normalized
branch keys. Authors may instead provide `routePolicy`, or retain an already
configured exact policy, when its ordered routes match those keys. Conflicting,
inexact, or mismatched policies fail before a graph is returned. The compiler
enforces membership, unique cases and targets, and exhaustive coverage.
Dedicated durable route-decision events remain follow-up work.

### `verifiedFanout`

Builds `work → lens verifiers → adjudicate`. Every verifier receives the full
work result. Each verdict reaches a unique adjudicator port named by the lens
key. The named graph output points to `adjudicate`.

This constructs the fan-out shape only. `validator` nodes fail closed in both
runtimes with zero attempts, and no verification, judge, rubric, or citation
runtime exists. Nothing here evaluates a verdict; the adjudicator you supply
does.

### `loopUntilDry`

**Declarative-only with the v1alpha1 scheduler.** This is a finite DAG, never a
cycle. `maxRounds` is required, must be an integer from `1` through `100`, and
must exactly equal `rounds.length`. Callers explicitly provide unique IDs for
each round's `find` and `checkDry` nodes:

```ts
const graph = loopUntilDry({
  metadata: { name: "bounded-discovery", version: "1.0.0" },
  maxRounds: 2,
  rounds: [
    { key: "round1", find: find1, checkDry: check1 },
    { key: "round2", find: find2, checkDry: check2 },
  ],
  finalize,
});
```

Each `find → checkDry` edge binds to the checker's `items` port. Every round
verdict binds to one unique finalize port named by the round key, so finalize
receives all verdicts without duplicate input binding. Non-final verdicts also
feed the next finder at `previousVerdict` with a fixed `LoopContinue` annotation.
Verdict edges use fixed `LoopDryVerdict` or `LoopVerdictAtBound` annotations.

The metadata capability is
`edge-condition-routing-and-early-stop/v1alpha1`. **No scheduler executes this
graph today.** The loop annotations are registered conditions that neither
runtime implements, so `runGraph`, `run_graph`, and durable start/resume all fail
the whole graph during capability preflight with `UNSUPPORTED_EDGE_CONDITION`,
zero node attempts, and no executor call. Use the constructor to author, hash,
diff, and visualize the blueprint; to actually run bounded repetition today, use
the standalone bounded-cycle controller in `@graph-engineering/runtime`. The
package does not claim or simulate runtime early-stop and does not modify the
Graph IR schema.

## Common envelope

All constructors require caller-owned metadata and nodes. Optional common fields
are `inputSchema`, `outputSchema`, `stateSchema`, `outputKey`, and `policies`.
Schemas default to `{ "type": "object" }`; `outputKey` defaults to `result`.
Policies are never weakened or overwritten—if a supplied policy rejects the
topology, construction fails with `GE_PATTERN_CORE_REJECTED`.

Constructors add two reserved metadata labels:

- `graphengineering.reacher-z.github.io/pattern`
- `graphengineering.reacher-z.github.io/runtime-capability`

An identical caller label is accepted. A conflicting value is rejected; caller
labels are never silently overwritten.

## Determinism and safety

- Caller node IDs are preserved exactly. The package generates no nodes and
  never rewrites an ID; empty or duplicate IDs fail.
- Node IDs follow Graph IR's `^[A-Za-z][A-Za-z0-9_.-]{0,127}$` contract. Pattern
  keys use the same alphabet with a 64-character maximum and reject reserved
  object keys.
- Worker, branch, and verifier sets are sorted by Unicode code point key, making
  input permutations canonical. Loop round order remains explicitly sequential.
- Generated edge IDs use fixed pattern namespaces and sequence numbers; caller
  IDs are never interpolated into edge IDs.
- Collections must contain `1..100` entries. Empty, duplicate, oversized, or
  unknown fields fail instead of being ignored.
- Input snapshotting examines property descriptors. Getters/setters are rejected
  without invocation. Cycles, sparse arrays, symbols, class instances, Date,
  Map, `undefined`, bigint, functions, and non-finite numbers are rejected.
- Every graph is compiled by canonical core, then recursively frozen. Mutating
  caller objects after construction cannot alter the graph.

Failures are `PatternInputError` instances with stable `code` and JSON-pointer
`path`. Importing this package performs no I/O, network access, registration, or
global mutation; `package.json` declares `sideEffects: false`.
