# Graph Engineering protocol specification

`graph.schema.json` is the language-neutral Graph IR contract.
`event.schema.json` defines the portable runtime event envelope.
`checkpoint.schema.json` defines the portable stored-checkpoint envelope.
`durable-json.schema.json` defines the tagged, checkpoint-safe encoding used by
scheduler recovery for portable finite JSON, including exact binary64 values.
`conformance/` contains inputs and expected results used by every native runtime,
including settled-barrier, deterministic route-selection, and bounded-pipeline
decision and coordination corpora.

Runtime scheduling is fixed by [runtime-semantics.md](runtime-semantics.md), and
local event/checkpoint behavior is fixed by
[persistence-semantics.md](persistence-semantics.md). Deterministic primitive
behavior is fixed by [primitives-semantics.md](primitives-semantics.md).
Scheduler-integrated continuation for one immutable DAG is fixed by
[durable-recovery-semantics.md](durable-recovery-semantics.md).
Standalone per-item streaming, bounded buffers, source backpressure, structured
failure policies, and cancellation are fixed by
[pipeline-semantics.md](pipeline-semantics.md). This standalone contract does
not activate Graph IR stream edges or durable item recovery.

## Canonical serialization v1alpha1

Before hashing a Graph IR document, implementations must:

1. Preserve array order.
2. Recursively sort object property names by Unicode code point.
3. Serialize UTF-8 JSON with no insignificant whitespace.
4. Encode booleans, strings, integers, arrays, objects, and null using normal JSON.
5. Calculate SHA-256 over the UTF-8 bytes and emit lowercase hexadecimal.

The v1alpha1 conformance corpus intentionally avoids floating-point values in
hashed documents. Full RFC 8785 number canonicalization must be adopted before
floating-point values become part of a stable hash contract.

Unknown fields are rejected by the graph envelope, nodes, edges, and metadata.
Extension data belongs under explicitly versioned `config` or policy objects.

`entrypoints` explicitly names every root that consumes graph input. This keeps
multiple independent roots legal while allowing the compiler to reject an
accidental disconnected component. `outputs` binds public result fields to node
endpoints; runtimes must not infer the public result from array order.

## Compiler diagnostic codes

The following codes are stable across languages:

- `GE1001_DUPLICATE_NODE`
- `GE1002_DUPLICATE_EDGE`
- `GE1003_MISSING_SOURCE`
- `GE1004_MISSING_TARGET`
- `GE1005_CYCLE`
- `GE1006_UNREACHABLE_NODE`
- `GE1007_INVALID_GRAPH`
- `GE1008_MISSING_ENTRYPOINT`
- `GE1009_MISSING_OUTPUT`
- `GE1010_ENTRYPOINT_HAS_INCOMING`
- `GE1101_MAX_FAN_OUT`
- `GE1102_MAX_DEPTH`

Compilers may attach language-specific explanatory messages and source
locations, but conformance tests compare the stable diagnostic code and
associated node/edge identifiers.
