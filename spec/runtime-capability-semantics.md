# Runtime capability truth contract

Status: v1alpha1 source contract

Contract identity: `runtime-capability/v1alpha1`

Graph IR is intentionally wider than the first native DAG scheduler. A graph
may be valid authoring input while still requiring execution semantics which a
particular runtime does not implement. Compilation success therefore is not an
execution claim. Before an ordinary or durable scheduler performs any work, it
MUST compare the captured graph with the closed capability set in this
document.

## Safety outcome

If one or more unsupported declarations are present, the complete graph fails
before dispatch. The result has:

- status `failed`;
- zero node results;
- zero attempts, scheduled nodes, completed nodes, executor calls and journal
  calls;
- one structured `UNSUPPORTED_RUNTIME_CAPABILITY` failure per declaration;
  and
- identical failure order, owner, code and message in TypeScript and Python.

Durable start and resume apply the same preflight before reading or appending
an event stream. An unsupported graph therefore performs zero store reads and
zero store writes. A caller cannot use an existing history to bypass the
current runtime capability boundary.

The exact failure message is:

```text
Runtime capability '<capability>' at '<path>' is not implemented by runtime-capability/v1alpha1
```

`path` is an RFC 6901 JSON Pointer. Dynamic pointer segments replace `~` with
`~0` and `/` with `~1`. Graph-level and policy failures are owned by the first
entrypoint. Node failures are owned by that node. Edge failures are owned by
the edge source. The owner is diagnostic attribution only; no node result is
created.

## Implemented capability set

This contract allows the current scheduler to execute only:

- node kinds `agent`, `model`, `tool`, `transform` and the compiler-validated
  integrated `router`;
- `barrier` nodes with no configuration, or exactly
  `{ "condition": "all" }`, as the current static all-success join;
- omitted edge mode or explicit `value` mode;
- retry without jitter, including an explicit `jitter: false`;
- graph policies `maxConcurrency`, `maxDepth`, `maxFanOut` and
  `maxTotalAttempts`; and
- the compile-only
  `graphengineering.reacher-z.github.io/typed-ports` policy extension.

Graph, node and edge schemas remain compile-time contracts in this tranche.
Their presence does not claim that the scheduler validates runtime values.
Runtime value-schema validation is an explicit non-claim below.

## Rejected capability set and stable labels

The following declarations fail closed:

| Declaration | Capability label | Path |
| --- | --- | --- |
| `stateSchema` | `graph-state` | `#/stateSchema` |
| `subgraph`, `validator`, or `human` node | `node-kind:<kind>` | `#/nodes/<i>/kind` |
| `barrier` config other than `{}` or exactly `{ "condition": "all" }` | `node-config:barrier` | `#/nodes/<i>/config` |
| present node cache | `node-cache` | `#/nodes/<i>/cache` |
| present node resources | `resource-admission` | `#/nodes/<i>/resources` |
| present node isolation | `isolation-provider` | `#/nodes/<i>/isolation` |
| `retry.jitter: true` | `retry-jitter` | `#/nodes/<i>/retry/jitter` |
| present edge map | `edge-map` | `#/edges/<i>/map` |
| `stream` or `artifact-ref` edge | `edge-mode:<mode>` | `#/edges/<i>/mode` |
| `maxDynamicNodes` | `dynamic-graph-patch` | `#/policies/maxDynamicNodes` |
| `maxDurationMs` | `graph-deadline` | `#/policies/maxDurationMs` |
| `maxCostUsd` | `cost-budget` | `#/policies/maxCostUsd` |
| any other policy key | `policy:<key>` | escaped `#/policies/<key>` |

Presence is significant for cache, resources, isolation and map; an empty
object still declares a capability. A barrier config is supported only when it
is empty or has the single key/value `"condition": "all"`.

## Deterministic issue order

Issues are emitted without deduplication in this exact order:

1. graph `stateSchema`;
2. nodes in declaration order, and within each node: kind, unsupported barrier
   config, cache, resources, isolation, true jitter;
3. edges in declaration order, and within each edge: map, unsupported mode;
4. policies: `maxDynamicNodes`, `maxDurationMs`, `maxCostUsd`, then remaining
   unsupported keys in Unicode code-point order.

The preflight consumes only the compiler-captured immutable graph. It must not
read accessors, invoke arbitrary host code, consult a clock, inspect a store or
mutate the document.

## Non-claims

This fail-closed gate does not implement any rejected feature. In particular,
it does not implement state reducers, runtime value-schema validation, stream
backpressure, artifact authority, subgraphs, settled/minimum/percentage/
quorum/deadline barriers, verifier panels, human
approval, cache semantics, resource admission, isolation, jitter, dynamic
patches, graph deadlines, cost accounting or extension policies. Each feature
must replace its own rejection only after a versioned contract, both native
implementations, conformance evidence and durable recovery behavior are
accepted.
