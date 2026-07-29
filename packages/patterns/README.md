# `@graph-engineering/patterns`

> **Runtime boundary:** `routedBranches` emits the fixed, versioned
> `RouteEquals` annotation executed by the current TypeScript and Python
> schedulers. `loopUntilDry` remains declarative-only: its verdict annotations
> do not yet stop later rounds early.

Zero-side-effect TypeScript constructors for deterministic, canonical Graph
Engineering Graph IR. Every result is detached from caller input, recursively
frozen, finite portable JSON, and accepted by `@graph-engineering/core` before it
is returned.

```ts
import {
  diamond,
  loopUntilDry,
  routedBranches,
  verifiedFanout,
} from "@graph-engineering/patterns";
```

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
`edge-condition-routing/v1alpha1`. The native schedulers execute only selected
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
`edge-condition-routing-and-early-stop/v1alpha1`. The current scheduler ignores
the annotations, executes all `maxRounds`, and gives all verdicts to `finalize`;
the finalizer must select the earliest dry result. The package does not claim or
simulate runtime early-stop and does not modify the Graph IR schema.

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
