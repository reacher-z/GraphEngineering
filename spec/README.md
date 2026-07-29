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
The authoring-to-execution capability boundary is fixed by
[runtime-capability-semantics.md](runtime-capability-semantics.md). It requires
ordinary and durable runtimes to reject every currently unimplemented Graph IR
semantic before dispatch or persistence instead of treating it as a plain DAG
value.
Standalone per-item streaming, bounded buffers, source backpressure, structured
failure policies, and cancellation are fixed by
[pipeline-semantics.md](pipeline-semantics.md). This standalone contract does
not activate Graph IR stream edges or durable item recovery.
General builders, strict JSON, safe YAML, opt-in typed ports, and immutable
initial graph identity are fixed by
[authoring-semantics.md](authoring-semantics.md). The machine-readable initial
identity envelope is [compiled-identity.schema.json](compiled-identity.schema.json).
Bounded dynamic-cycle and append-only patch behavior is frozen by
[cycle-semantics.md](cycle-semantics.md). Its standalone carrier and effective
policy/result contracts are
[cycle-controller.schema.json](cycle-controller.schema.json),
[cycle-controller-policy.schema.json](cycle-controller-policy.schema.json), and
[cycle-controller-result.schema.json](cycle-controller-result.schema.json).
Later revision lineage is closed by
[graph-revision.schema.json](graph-revision.schema.json); the separate durable
controller event and fold/checkpoint contracts are
[cycle-controller-event.schema.json](cycle-controller-event.schema.json) and
[cycle-controller-checkpoint.schema.json](cycle-controller-checkpoint.schema.json).
Bounded root-to-target export for offline replay is closed by
[cycle-controller-lineage-manifest.schema.json](cycle-controller-lineage-manifest.schema.json).
The provider-neutral storage boundary is fixed by
[cycle-store-provider-semantics.md](cycle-store-provider-semantics.md) and the
closed [cycle-store-provider.schema.json](cycle-store-provider.schema.json)
descriptor. Its 54-case native differential campaign covers append CAS,
idempotency, snapshot pagination, disposable checkpoints, fencing, tenant
authorization, governance, and migration exclusion without claiming that the
memory oracle is durable.
The SQLite operation-ledger v2 byte and replay protocol is fixed by
[sqlite-operation-ledger-v2.md](sqlite-operation-ledger-v2.md). Its v1 source
reconciliation boundary, FILE-backed TEMP requirements, stable `BLR_*` rules,
safe diagnostics, and cursor-seal domains are fixed by
[sqlite-baseline-reconciliation.md](sqlite-baseline-reconciliation.md) and the
closed conformance registry under `conformance/`. These contracts retain
`implementationClaim:false` until the native relation, cursor, migration,
crash, replay, and exact-campaign gates are complete.
These D7 schemas are protocol-frozen and consumed by the native TypeScript and
Python standalone alpha controllers. Schema acceptance alone is not native or
production evidence; executable conformance remains the capability gate. Their
v1alpha1 authoritative payloads are explicitly inline-unredacted and therefore
do not satisfy the still-open D9 protected-payload or stable-release gate.

## Canonical serialization v1alpha1

Before hashing a Graph IR document, implementations must:

1. Preserve array order.
2. Recursively sort object property names by Unicode code point.
3. Serialize UTF-8 JSON with no insignificant whitespace.
4. Encode booleans, strings, arrays, objects, and null using the frozen project
   JSON rules.
5. Serialize every accepted finite binary64 number with ECMAScript's
   shortest-round-trip number algorithm: normalize negative zero to `0`, use
   fixed notation for magnitudes from `1e-6` (inclusive) through `1e21`
   (exclusive), and otherwise use lowercase scientific notation with an
   explicit `+` for positive exponents.
6. Calculate SHA-256 over the UTF-8 bytes and emit lowercase hexadecimal.

The numeric rule is the finite-binary64 serialization defined by RFC 8785
Section 3.2.2.3 and ECMA-262 `Number::toString`, including closest-value and
round-to-even selection. The shared
[`canonical-number.case.json`](conformance/canonical-number.case.json) corpus
separates low-level formatter vectors from the public portable domain and
freezes unsafe-integer/non-finite rejection, a seeded differential, and a
fractional JSON/YAML/compiler/builder graph identity. This is not a claim of
full RFC 8785 JCS conformance: Graph IR property ordering remains
Unicode-code-point order, not RFC 8785's UTF-16-code-unit order. Integer-valued
numbers outside
`[-(2^53-1), 2^53-1]` and all non-finite numbers remain invalid Graph IR.

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
- `GE1201_MISSING_SOURCE_PORT`
- `GE1202_MISSING_TARGET_PORT`
- `GE1203_PORT_SCHEMA_MISMATCH`
- `GE1204_DUPLICATE_TARGET_BINDING`
- `GE1205_INVALID_PORT_SCHEMA`
- `GE1206_OUTPUT_SCHEMA_MISMATCH`
- `GE1207_ENTRYPOINT_SCHEMA_MISMATCH`
- `GE1208_UNSUPPORTED_TYPED_EDGE_MODE`
- `GE1301_UNSUPPORTED_GRAPH_REVISION`
- `GE1302_GRAPH_IDENTITY_MISMATCH`
- `GE1303_COMPONENT_IDENTITY_MISMATCH`

Compilers may attach language-specific explanatory messages and source
locations, but conformance tests compare the stable diagnostic code and
associated node/edge identifiers.
