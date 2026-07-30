# Subgraph, reducer, artifact-reference, stream-edge, and trace semantics v1alpha1

Status: **machine-frozen contract candidate; native execution is not
implemented or available**

This document defines the portable behavior required for nested subgraphs,
shared-state reducers, content-addressed artifact references, durable Graph IR
stream edges, and their trace/checkpoint lineage. It is a contract for future
TypeScript and Python implementations. It does not activate those capabilities
in the current runtime.

The current Graph IR accepts `kind: "subgraph"`, `mode: "stream"`,
`mode: "artifact-ref"`, and `stateSchema` as vocabulary. The current native
schedulers do not lower any of them. In particular, the non-strict scheduler
currently binds stream and artifact edges as ordinary terminal values, and a
caller-provided executor for a `subgraph` node is merely an ordinary executor.
Neither behavior satisfies this contract. A conforming D4 entrypoint must fail
before invoking an executor unless every required capability is negotiated and
the complete sidecar plan has passed the checks below.

The existing contracts remain unchanged:

- [`graph.schema.json`](graph.schema.json) continues to describe immutable
  Graph IR v1alpha1 documents;
- [`runtime-semantics.md`](runtime-semantics.md) continues to define the
  one-terminal-value DAG scheduler;
- [`pipeline-semantics.md`](pipeline-semantics.md) continues to define a
  standalone, in-memory item pipeline, not a Graph IR stream edge;
- [`durable-recovery-semantics.md`](durable-recovery-semantics.md) continues to
  define one immutable revision-1 DAG and explicitly excludes nested recovery,
  artifact storage, streams, replay, and fork; and
- the D7 [`cycle-semantics.md`](cycle-semantics.md) contract remains a separate
  standalone child-controller protocol.

No schema, fixture, event name, hash, or status line in this document is
evidence that either native runtime executes D4.

## 1. Normative machine artifacts

The v1alpha1 contract consists of these D4-owned files:

| Artifact | Normative role |
| --- | --- |
| [`subgraph-edge-plan.schema.json`](subgraph-edge-plan.schema.json) | Closed, capability-negotiated sidecar plan binding exact Graph IR snapshots to calls, reducers, artifact edges, stream edges, and finite global limits. |
| [`artifact-ref.schema.json`](artifact-ref.schema.json) | Closed portable reference to content-addressed bytes, including provenance and lifetime. |
| [`subgraph-edge-event.schema.json`](subgraph-edge-event.schema.json) | Closed event envelope and discriminated payloads for invocation, reducer, artifact, and stream facts. |
| [`subgraph-edge-checkpoint.schema.json`](subgraph-edge-checkpoint.schema.json) | Rebuildable event-prefix projection for nested scopes, reducer state, artifact holds, and stream offsets. |
| [`subgraph-edge-trace.schema.json`](subgraph-edge-trace.schema.json) | Closed metadata-only normalized trace projection consumed by future exporters and Explorer surfaces. |
| [`conformance/subgraph-edge.case.json`](conformance/subgraph-edge.case.json) | Language-neutral source graphs, plan template, positive scenario, hashes, schema negatives, semantic negatives, and hostile history/checkpoint vectors. |
| [`conformance/subgraph-edge.validate.mjs`](conformance/subgraph-edge.validate.mjs) | Independent offline schema, hash, plan, fold, backpressure, reducer, artifact, checkpoint, and hostile-vector oracle. |

When prose and a schema disagree, the schema controls document shape and this
document controls semantic validity. When either disagrees with a golden hash
or fold in the conformance case, the disagreement is a contract defect that
must be versioned and reviewed; an implementation must not choose whichever
interpretation is convenient.

The sidecar plan is deliberate. Graph IR v1alpha1 has no closed field for a
subgraph resolver, reducer, ArtifactStore, stream queue, or D4 capability
negotiation. Free-form `NodeSpec.config`, graph labels, prompts, and executor
options are not valid substitutes. A later Graph IR/API revision may embed or
reference this plan only through an explicit migration and API-freeze review.

## 2. Terminology and authority

- A **graph binding** is the exact hash and normalized inventory of one
  immutable Graph IR v1alpha1 document.
- A **call binding** maps one `kind: "subgraph"` node in an owner graph to one
  child graph binding.
- An **invocation** is one runtime instance of a graph binding. Repeated calls
  and retries do not share mutable scope by accident.
- A **scope** is the run-, plan-, graph-, and invocation-bound namespace for
  node state, reducer state, artifacts, streams, events, and checkpoints.
- A **projection** deterministically maps a parent node input into child graph
  input or child named outputs into the parent node output.
- A **reducer batch** is one declaration-ordered, exactly idempotent state
  transition over an explicit state pointer.
- An **ArtifactRef** identifies verified bytes and carries a closed, scoped
  capability envelope. The capability is not ambient authority: its tenant,
  run, action, expiry, and authority identity must all validate on every read.
- A **stream edge** is a single-producer, single-consumer, source-ordered,
  explicitly demanded, durably acknowledged item channel bound to one Graph IR
  edge.
- The **event stream** is the authority for D4 progress. A checkpoint is only a
  cache of a validated event prefix.

The D4 event stream is separate from `scheduler-recovery/v1alpha1` and from the
D7 cycle-controller stream. An event from one protocol cannot authorize a
transition in another. Current `EdgeEmitted` events remain single value-edge
markers and cannot be reinterpreted as stream acknowledgements or artifact
publication.

## 3. Canonical bytes and domain-separated identity

All documents first pass the repository's finite portable-JSON boundary.
Objects are recursively ordered by Unicode code point, arrays retain their
declared order, compact JSON is encoded as UTF-8, and lowercase SHA-256 is used.
No Unicode normalization, object-array reordering, implicit default insertion,
or null-to-absence coercion is permitted.

`H(domain, value)` means SHA-256 over the UTF-8 bytes of the domain string
followed immediately by canonical UTF-8 JSON for `value`. The terminating NUL
shown below is one literal zero byte represented by `\0` in the JavaScript
oracle.

| Identity | Exact domain/preimage |
| --- | --- |
| Graph hash | Ordinary SHA-256 of the complete canonical Graph IR document; no D4 domain prefix is added. |
| Plan hash | `H("graph-engineering/subgraph-edge-plan/v1alpha1\0", completePlan)`; the plan contains no self hash. |
| Per-graph compiled-plan hash | `H("graph-engineering/subgraph-edge-compiled-plan/v1alpha1\0", graphBindingWithoutCompiledPlanHash)`. |
| Portable D4 value hash | `H("graph-engineering/subgraph-edge-value/v1alpha1\0", value)`. |
| Projection hash | `H("graph-engineering/subgraph-edge-projection/v1alpha1\0", projectionContract)`; the root-input identity contract is exactly `{ "mode": "root-input" }`. |
| Invocation ID | The scope preimage in Section 5. |
| Reducer write ID | The reducer-write preimage in Section 7. |
| Reducer batch ID | The reducer-batch preimage in Section 7. |
| Artifact byte digest | Ordinary SHA-256 of the exact raw, identity-encoded artifact bytes. |
| Artifact ID | The artifact preimage in Section 8. |
| Artifact capability ID | `H("graph-engineering/artifact-capability/v1alpha1\0", [artifactId, capabilityWithoutCapabilityId])`. |
| Stream ID and item hash | The stream preimages in Section 9. |
| Event payload hash | Ordinary SHA-256 of canonical `event.data`. |
| Event hash | The event preimage in Section 10. |
| Checkpoint content hash | The checkpoint preimage in Section 11. |
| Normalized trace content hash | `H("graph-engineering/subgraph-edge-trace/v1alpha1\0", completeTraceWithoutContentHash)`. |

Hashes are integrity and identity values. They are not encryption, redaction,
authorization, signatures, MACs, or proof that a model/tool result is true. An
unkeyed artifact digest can leak equality for low-entropy content. D4 therefore
cannot activate artifact or stream persistence until the later D9 artifact and
stream sink policy accepts the representation.

## 4. Plan construction, validation, and activation

### 4.1 Closed carrier

The sidecar resource is exactly:

```text
apiVersion: graphengineering.reacher-z.github.io/subgraph-edge-plans/v1alpha1
kind: SubgraphEdgePlan
contractVersion: subgraph-edge/v1alpha1
activation: requires-capability-negotiation
namespaceCodec: rfc6901-segments/v1alpha1
```

It contains one root graph key, a closed policy, deny-by-default authority
ceiling, hard root budget, resume/replay/fork policy, metadata-only trace
policy, exact graph bindings, call bindings, reducers, artifact-edge policies,
and stream-edge policies. Unknown fields fail schema validation. The plan hash
covers every bound value and every array order.

The exact sorted capability array is:

```text
artifact-store/v1alpha1
durable-stream-edge/v1alpha1
nested-subgraph/v1alpha1
state-reducer/v1alpha1
subgraph-edge/v1alpha1
trace-checkpoint-lineage/v1alpha1
```

These names express requirements. They do not claim that an ArtifactStore,
durable stream runtime, or trace implementation exists. The artifact and stream
edge entries additionally require the future contracts
`artifact-sink-policy/v1alpha1` and `stream-sink-policy/v1alpha1`. Those policy
contracts are not implemented in the current repository. Negotiation therefore
fails closed today.

### 4.2 Graph binding

Before plan hashing or execution, a compiler must independently compile each
source Graph IR document and derive its binding:

1. `graphHash` is the compiled canonical document hash;
2. `compiledPlanHash` binds the normalized executable inventory independently
   of the enclosing D4 plan;
3. `stateSchemaHash` is the canonical state schema hash or explicit null;
4. `graphRevision` is exactly `1` for this contract;
5. `nodes` repeats each node's ID and kind in Graph IR declaration order;
6. `edges` repeats each edge's ID, source node, target node, and materialized
   mode in Graph IR declaration order; omitted Graph IR mode becomes `value`
   only in this derived inventory;
7. `entrypoints` retains Graph IR order; and
8. output names are ordered by Unicode code point.

The `graphs` array itself is ordered by graph key. Duplicate graph, node, edge,
call, reducer, or edge-policy identities fail. A plan that supplies a correct
graph hash with a substituted inventory, or a correct inventory with a
substituted hash, fails `GE_D4_GRAPH_BINDING_MISMATCH`.

Every `kind: "subgraph"` node in a bound graph has exactly one call binding.
Every `stream` and `artifact-ref` edge has exactly one matching edge policy. A
policy attached to a `value` edge or to the other non-value mode is invalid.
No unmatched non-value edge can fall back to value binding.

### 4.3 Finite limits

The plan materializes all of these limits:

- nesting depth and recursion depth;
- total and concurrent graph invocations;
- canonical state bytes and total reducer writes;
- artifact count, per-artifact bytes, and total reserved artifact bytes;
- stream-edge count, items per edge, total stream items, and total in-flight
  stream bytes;
- normalized trace spans, links, and bytes;
- namespace UTF-8 bytes; and
- total duration bounded to the repository's 32-bit host-timer ceiling.

Every child policy is an equal or narrower slice of its parent plan. Per-call,
per-reducer, per-artifact, and per-stream maxima cannot exceed the corresponding
global limit. The sum of stream `maxItems` reservations cannot exceed
`maxTotalStreamItems`. Counts are safe integers. There is no `unlimited`,
negative, infinity, omission-as-unlimited, or retry-based reset.

Every call declares requested and effective capabilities. Effective authority
is exactly the sorted intersection with the parent ceiling; a child can narrow
but never add authority. Its attempts, duration, state, artifact, stream-item,
and in-flight-byte allocation must be no larger than the parent allocation.
The runtime reserves those resources before `InvocationCreated`. A failed
reservation creates no invocation, store write, source pull, or executor call.
Settlement and release cannot produce a negative balance or make a committed
fact disappear.

### 4.4 Validation and error precedence

Before any D4 event or executor call, implementations apply this order:

1. snapshot portable JSON and validate the plan schema;
2. negotiate the exact capability/version set and sink-policy requirements;
3. compile every Graph IR document through the ordinary compiler;
4. compare every graph hash and normalized inventory;
5. validate call/reducer/edge cross-references and call-graph recursion;
6. validate every finite per-entry/global bound and worst-case reservation;
7. bind the plan hash and root graph identity; and
8. only then create the root invocation event.

Malformed input wins over unavailable runtime work. Capability failure wins
before an executor. Graph compilation diagnostics retain their existing `GE1*`
codes. D4 plan errors are structured values; they are never converted to an
empty plan or a value-only graph.

## 5. Invocation namespaces and nested checkpoint scope

### 5.1 Scope identity

For run `R`, plan hash `P`, parent invocation ID `Q` (or null), call ID `C`
(or null for root), call ordinal `O`, and child graph hash `G`:

```text
invocationId = H(
  "graph-engineering/subgraph-edge-scope/v1alpha1\0",
  [R, P, Q, C, O, G]
)
```

The root uses `[R, P, null, null, 0, rootGraphHash]`. A child uses its exact
parent invocation ID, declared call ID, zero-based call ordinal within that
parent/call, and child graph hash. Retries of the same committed logical call
reuse the invocation ID. A different parent, call ordinal, plan, graph, or run
cannot collide without a SHA-256 collision.

The portable namespace is:

```text
/runs/<escaped-run-id>/invocations/<invocation-id>
```

Escaping is RFC 6901 segment escaping only: `~` becomes `~0`, then `/` becomes
`~1`. No percent decoding, Unicode normalization, path normalization, host
separator conversion, or filesystem interpretation is permitted. Implementers
may derive node, edge, reducer, stream, artifact, and checkpoint keys by adding
escaped literal segments to this logical namespace, but must never use the
logical string as an unvalidated host path.

Each scope records parent invocation, graph key/hash/revision, zero-based depth,
call ID/ordinal, recursion group, and recursion depth. Root depth is zero. A
child checkpoint is isolated: its state cannot overwrite a parent or sibling
projection even when node IDs, reducer IDs, or checkpoint IDs are identical.

### 5.2 Creation and lifecycle

A child invocation can be created only when:

- its parent is running and owns the declared call node;
- the parent input has been successfully projected and validated;
- call ordinal is the next unused ordinal and below `maxCallsPerParent`;
- global invocation, concurrency, duration, depth, and recursion reservations
  succeed;
- the child graph hash and implementation/capability identity still match; and
- the child `InvocationCreated` event commits.

The child executor is invoked only after `InvocationStarted` commits. Its
successful named outputs become visible only after output projection,
portable-JSON capture, applicable schema validation, artifact/stream settlement,
and `InvocationSucceeded` commit. Failure or cancellation is a structured
terminal invocation event. A parent never receives null in place of a failed
child.

Root completion waits for every output-relevant child, reducer, artifact edge,
and stream edge to reach its defined terminal state. A child that is unrelated
to another ready branch does not introduce a whole-graph barrier.

### 5.3 Authority, propagation, recovery, and boundary transfer

Parent cancellation reaches the child before its next durable commit. Child
failure fails the call edge with the original structured failure; child
cancellation cancels the call edge. A non-cooperative child is retained as
in-doubt and cannot release downstream work. Parent failure after a child
commit retains the child history but does not silently authorize reuse.

Resume folds the isolated child event scope before dispatch. Replay is
read-only and projects the recorded child history with zero executor/store/
provider calls. Fork allocates a new run and invocation namespace and repeats
authority and budget admission. Successful child internals are reusable only
when input, graph, compiled plan, policy and committed terminal identities all
match. Artifacts cross only as explicitly authorized `ArtifactRef` values;
streams cross through a new descriptor and never inherit credits, acks or
write authority.

## 6. Entry and output projection

### 6.1 JSON Pointer profile

Pointers are either the empty string or slash-separated RFC 6901 segments.
Only `~0` and `~1` escapes exist. `-` has no array-append meaning. Array indices
must be canonical decimal member names as observed in parsed JSON; projection
does not coerce keys, create parents, flatten arrays, call getters, or evaluate
code.

An empty pointer selects the complete source value. A missing path is distinct
from a present JSON null. `required: true` missing input fails
`GE_D4_PROJECTION_MISSING`; `required: false` omits the target key. Neither case
inserts null.

### 6.2 Input projection

`mode: "whole"` passes a detached snapshot of the complete parent node input as
the child graph input. `mode: "object"` builds a new null-prototype logical map
from the ordered field list:

1. select `sourcePointer` from the parent node input;
2. apply the required/optional missing rule;
3. reject a repeated `targetKey`; and
4. insert a detached value without prototype setters or property coercion.

All child entrypoints receive the same projected child graph input, preserving
Graph IR v1alpha1's explicit-entrypoint rule. Projection never invents a
different per-entrypoint input. A later protocol needs a new carrier if that
behavior is required.

### 6.3 Output projection

The source is the complete map of the child graph's declared named outputs.
`mode: "whole"` returns a detached snapshot of that map. `mode: "object"`
selects each declared `sourceOutput`, then its `sourcePointer`, and binds it to
one unique target key under the same required/optional rules.

The source output name must exist in the bound child graph inventory. The
runtime cannot read an arbitrary internal child node. A child output is not
released until its Graph IR endpoint has succeeded. Projected output is then
validated against the parent subgraph node's output contract before persistence
or downstream binding. General runtime JSON Schema execution is not present in
the current runtimes and is part of the native D4 handoff, not evidence already
delivered.

Projection field order is part of the plan hash. The resulting JSON object's
canonical byte identity is independent of host insertion order because object
keys canonicalize by code point.

## 7. Recursion and depth convergence

Nested acyclic calls use `recursion.mode: "forbid"`. The plan compiler builds a
call graph over graph keys. If an owner-to-child call participates in a
strongly connected component, every call edge inside that component must use:

```text
mode: bounded
group: one shared non-empty group ID
maxDepth: one shared positive bound
onLimit: structured-failure
```

The bound must not exceed either `policies.maxRecursiveDepth` or
`policies.maxNestingDepth`. Acyclic calls cannot claim a recursion group.

`recursionDepth` counts committed call transitions in the named group along the
current ancestor lineage. A call may enter when the existing count is strictly
less than `maxDepth`; the child records the incremented count. At the bound, no
scope, event reservation, executor, source pull, artifact write, or stream is
created. The call settles with `GE_D4_RECURSION_LIMIT`.

The independent global protections still apply:

- root depth is zero and child depth is parent depth plus one;
- child depth cannot exceed `maxNestingDepth`;
- total created invocations cannot exceed `maxTotalInvocations`;
- active invocations cannot exceed `maxConcurrentInvocations`;
- one parent/call cannot exceed `maxCallsPerParent`; and
- duration, state, artifact, stream, and attempt controls do not reset at a
  recursion boundary.

This is bounded nested invocation, not an implicit Graph IR edge cycle. Ordinary
graph cycles remain compiler errors. D7 cycle-controller semantics are not
silently imported into D4.

## 8. Concurrent state reducers

### 8.1 Compile-time conflict rules

A reducer binds one `kind: "transform"` node in a graph that declares a
content-bound `stateSchema`. It names a non-root state pointer, explicit
required invocation state or a hash-bound literal initial value, one or more
contributors, a versioned built-in or content-addressed custom implementation,
its algebraic law, `reject-overlap`, `exact-batch` idempotency, CAS/state-version
commit, sink policy, and finite write/state/update byte bounds.

Within one graph binding, two reducer state pointers conflict when their
decoded pointer segments are equal or one is a prefix of the other. `/a` and
`/a/b` therefore overlap; `/a` and `/ab` do not. Every overlap fails the plan.
Ad hoc writes outside a declared reducer fail. A reducer cannot list itself as
a contributor, name an absent node, or bind more contributions than its write
limit.

### 8.2 Eligibility and missing contributors

The reducer becomes eligible only after every contributor is terminal. It
reads successful outputs through each contributor's `outputPointer`.

- A required missing/failed/skipped/cancelled contributor fails the reducer.
- An optional non-success creates an explicit absent write with contributor
  ordinal, node ID, stable D4 failure code, and terminal status.
- A successful JSON null is a present write whose value is null.
- Completion order never changes reducer order.

The complete bounded write list is validated before any state mutation. A
partial list never commits.

### 8.3 Operations

All operations apply present writes in contributor declaration order:

| Operation | Required current state | Exact transition |
| --- | --- | --- |
| `ordered-replace` | Any portable JSON value | Replace with each present write in order; the last present write is the result. At least one present write is required. |
| `ordered-append` | Array | Append each present write as one array element. A contributed array is one element, not implicitly flattened. |
| `merge-disjoint` | Object | Each present write must be an object. Its keys are traversed by Unicode code point. A key already in state or an earlier write fails the entire batch; no overwrite occurs. |
| `set-union-by-hash` | Array | Combine existing elements and present writes, dedupe exact canonical values by D4 value hash, reject a same-hash/different-byte collision, and order the result by lowercase hash then canonical bytes. |
| `bounded-integer-sum` | Safe integer plus explicit inclusive bounds | Sum in a portable safe-integer domain; intermediate overflow or a final value outside the declared bounds fails the entire batch. |
| `bounded-integer-min` | Safe integer plus explicit inclusive bounds | Select the minimum across state and present writes, then enforce the declared bounds. |
| `bounded-integer-max` | Safe integer plus explicit inclusive bounds | Select the maximum across state and present writes, then enforce the declared bounds. |
| `custom-deterministic` | Declared by its closed transform contract | Execute only a versioned content-digest/entrypoint identity with `authority: none`; ambient clock, network, filesystem, model, tool and mutable process state are forbidden. |

Ordered replace/append/disjoint merge are declaration-ordered and
non-commutative. Set union and bounded integer reducers declare a
commutative/associative law while still emitting a canonical report order.
Custom laws are bound by the content-addressed transform. The post-state must
remain portable JSON, satisfy `stateSchema` under the
versioned runtime validator profile, and fit `maxStateBytes`. Any validation,
hash, conflict, or size failure leaves the previous state/version authoritative.

### 8.4 Write and batch identity

For invocation `I`, reducer `R`, contributor ordinal `O`, node `N`, and value
hash `V`, a present write ID is:

```text
H(
  "graph-engineering/subgraph-edge-reducer-write/v1alpha1\0",
  [I, R, O, N, V]
)
```

An absent write uses the literal `"absent"` in place of `V`. For current state
version `S` and complete ordered write array `W`, the batch ID is:

```text
H(
  "graph-engineering/subgraph-edge-reducer-batch/v1alpha1\0",
  [I, R, S, W]
)
```

`StateReducerCommitted` contains before/after versions, before hash, the exact
ordered write records, complete after-state value, and after hash. The event
commits atomically before any reader or dependent can observe the new state.
`stateVersionAfter` is exactly `stateVersionBefore + 1`.

An exact repeated batch ID with byte-identical payload is an idempotent no-op
and does not advance the state version. Reusing a batch ID for different bytes
is `GE_D4_REDUCER_IDEMPOTENCY_CONFLICT`. Replaying a contributor completion
cannot double-append or overwrite twice.

## 9. Artifact-reference edges

### 9.1 Portable reference and content identity

An ArtifactRef contains no filesystem path, URL or credential. It contains a
closed capability that is useful only after the store independently verifies
its bindings. The complete carrier includes:

- exact protocol/kind;
- `storeId`, logical storage namespace, tenant and run binding;
- `algorithm: "sha256"`, lowercase digest, and exact raw byte length;
- media type, logical name and `encoding: "identity"`;
- truthful test-only-unprotected or protected-reference disposition;
- retention policy/timestamps and run/lineage/pinned lifetime;
- capability ID, authority hash, closed actions and optional expiry; and
- creation provenance: plan, run, invocation, graph, producer node, edge, and
  task/attempt identity plus optional stream item sequence.

The artifact ID preimage excludes `apiVersion`, `kind`, and `artifactId` and is
exactly this closed body:

```text
{
  storeId,
  storageNamespace,
  tenantId,
  runId,
  algorithm,
  digest,
  sizeBytes,
  mediaType,
  encoding,
  logicalName,
  protection,
  retention,
  lifetime,
  createdBy
}
```

```text
artifactId = H(
  "graph-engineering/artifact-ref/v1alpha1\0",
  body
)
```

Changing provenance or lifetime changes artifact ID even when content bytes are
identical. The separately derived capability ID binds the artifact ID to its
authority/actions/expiry. The raw content digest continues to prove content
equality, but neither digest grants authority.

### 9.2 Atomic publication and edge release

For `mode: "artifact-ref"`, the producer's selected endpoint value is encoded
to the declared identity bytes by a versioned codec. Before the target can
receive a reference, the runtime must:

1. reserve artifact count and byte capacity;
2. validate media type, codec, and maximum bytes without truncation;
3. compute digest and length over exact final bytes;
4. write to a temporary/private store object through an authorized capability;
5. fsync/commit or otherwise atomically publish under the store contract;
6. read/verify store metadata or bytes as the provider contract requires;
7. construct and validate ArtifactRef;
8. commit `ArtifactPublished`; and
9. only then release the ref across the edge.

A crash before publication produces no valid ref. A crash after atomic store
publication but before the event can leave an unreferenced safe orphan; it is
not success and is eligible only for separately authorized orphan cleanup. A
crash after the event reuses the exact ref and never republishes under a new
identity.

On every read, tenant/run/namespace/capability/expiry authorization, existence,
exact length, and digest are verified
before decoding. `ArtifactReadVerified` records the verified identity, not
content. A mismatch is `GE_D4_ARTIFACT_CORRUPT`; the target is not invoked and
does not receive null, an empty object, stale cache content, or unverified
bytes.

### 9.3 Lifetime and garbage collection

- `run` remains readable through terminal result retention for the originating
  run. It cannot authorize replay/fork.
- `lineage` remains while any retained run, event history, checkpoint, result,
  replay, or fork lineage references it.
- `pinned` additionally requires a unique pin ID and an explicit authorized
  unpin.

`ArtifactReleased` releases one runtime hold. It never asserts that bytes were
deleted. Physical deletion is permitted only when every active hold is gone,
the lifetime rule allows it, no retained authoritative record refers to it,
and the store's authorized mark-and-sweep/retention transaction succeeds. The
golden lineage artifact remains `eligibleForGc: false` after its edge hold is
released because retained events and the checkpoint still refer to it.

### 9.4 Structured artifact failures

The stable family covers store unavailable, publication failed, not found,
corrupt, unauthorized, oversized, and expired. Every failure has phase `artifact`, a safe
message template, retryability, edge identity in its event payload where
applicable, and no raw content or credential. `onError: "fail-edge"` is the only
v1alpha1 policy. Failure never becomes a successful null edge.

No ArtifactStore exists today. The D9 draft also denies general artifact sinks
until a future ArtifactStore policy versions the source/sink inventory. Thus
this schema freezes content/ref/lifetime behavior only; it cannot close storage,
redaction, production, or release gates.

## 10. Durable stream edges

### 10.1 Scope and identity

One D4 stream edge explicitly declares `topology: one-to-one`, producer,
consumer, item-schema hash, source order, one item mode, finite item/buffer/
unacknowledged/in-flight-byte capacities, explicit credit, at-least-once
delivery, terminal-frame policy, spill policy, checkpoint boundary, duplicate
suppression and trace metrics. Multicast, partition, merge, joins, windows,
watermarks and materializing barriers are rejected and require later versions.

For run `R`, plan `P`, owner invocation `I`, graph key `G`, and edge `E`:

```text
streamId = H(
  "graph-engineering/subgraph-edge-stream/v1alpha1\0",
  [R, P, I, G, E]
)
```

For item sequence `S`, item mode `M`, and exactly one of value/ref `V`:

```text
itemHash = H(
  "graph-engineering/subgraph-edge-stream-item/v1alpha1\0",
  { streamId, itemSequence: S, itemMode: M, value: V }
)
```

For artifact-ref items, the key is `artifactRef` rather than `value`; the
schema enforces exactly one representation. Each publication also binds an
item-attempt ID and exact canonical item bytes; each delivery/ack pair binds a
delivery-attempt ID, so retry identity cannot be inferred from wall time.

### 10.2 Counters and demand

Counters are monotonic safe integers:

```text
availableDemand = totalDemand - published
buffered = published - delivered
unacknowledged = delivered - acknowledged
0 <= acknowledged <= delivered <= published <= totalDemand <= maxItems
buffered <= bufferCapacity
unacknowledged <= maxUnacknowledged
buffered-and-unacknowledged bytes <= maxInFlightBytes
```

`StreamDemandGranted` is the only way to add credit. One grant is positive and
no larger than `maxDemandPerGrant`; cumulative demand cannot exceed `maxItems`.
Acknowledgement does not implicitly create credit.

The producer may request/pull/accept its next source item only when all are
true:

- available demand is positive;
- the durable buffer has a free slot;
- item and global stream reservations remain;
- cancellation/failure/source-close is absent; and
- the item byte bound can be enforced.

Demand and buffer capacity are checked **before** a source pull. Consequently a
zero-demand consumer stops the source, and a slow consumer fills a fixed
buffer rather than an unbounded hidden result array.

### 10.3 Publish, delivery, and acknowledgement

Item sequences start at zero and are contiguous. The runtime validates and
detaches a value, or validates/publishes an ArtifactRef, before committing
`StreamItemPublished`. Publication consumes one demand credit and one buffer
slot. The consumer cannot observe an item before that event commits.

Delivery removes the next source-ordered item from the buffer and creates one
unacknowledged delivery. At-least-once recovery may deliver the same published,
unacknowledged item again with a larger `deliveryAttempt`; it does not allocate
a new item sequence or rerun the source. The target acknowledges only after its
own durable acceptance boundary. Acknowledgements are source ordered and bind
the delivery attempt.

`StreamSourceClosed` records the exact published count and forbids later
publication. `StreamCompleted` is legal only when source is closed, buffer and
unacknowledged sets are empty, and:

```text
published == delivered == acknowledged
```

Fast items may progress as soon as their own demand, buffer, and consumer slot
permit. There is no whole-source or topological-layer barrier.

### 10.4 Failure and cancellation

The first committed terminal stream event wins:

- a source, validation, queue, sink-policy, artifact, consumer, or protocol
  failure commits `StreamFailed` with exact counters and structured failure;
- observed caller/parent cancellation commits `StreamCancelled` with exact
  counters and safe reason; and
- a fully drained normal source commits `StreamCompleted`.

No terminal event can be followed by a publish, deliver, ack, close, or second
terminal event. Once cancellation is observed, no intentional source pull,
publication, or new delivery begins. Active external work remains cooperative
and at-least-once; D4 cannot undo an effect.

Failed/cancelled/unacknowledged items are explicit facts. A downstream value
binding is absent and accompanied by a structured edge failure. The runtime
must not invoke a value-oriented target with null, silently drop an item, report
an empty successful collection, or reinterpret the stream as the producer's
terminal node output.

### 10.5 Recovery

Resume validates and folds the complete D4 event prefix before invoking a
source or consumer. It reconstructs demand, next item sequence, buffered items,
unacknowledged deliveries, source-close, and terminal state.

- committed published items are never pulled again;
- committed acknowledged items are never delivered again;
- committed unacknowledged items may redeliver with the same identity;
- an in-memory item with no publication event does not exist durably;
- an ack with no matching delivered item is corrupt history; and
- capacity/demand reservations do not reset on resume.

Replay is read-only and returns recorded stream facts without source/consumer
dispatch. Fork creates a new run/scope/stream identity and separately authorizes
its item policy; copying refs, demand, acks or write capability as authority is
invalid. Those carriers are frozen here, while native replay/fork execution
remains downstream Open.

## 11. Event and trace lineage

### 11.1 Envelope and hash chain

Every event has:

```text
apiVersion: graphengineering.reacher-z.github.io/subgraph-edge-events/v1alpha1
kind: SubgraphEdgeEvent
contractVersion: subgraph-edge-recovery/v1alpha1
```

The run has one global contiguous sequence across all nested scopes.
Every event additionally binds event-stream and revision hashes, explicit
start/resume/replay/fork lineage, a nondecreasing run-relative monotonic
offset, compiled-plan identity in scope, and deterministic trace/span context.
`expectedPreviousSequence` is `sequence - 1`; the first event uses `-1` and a
null previous hash. Every later `previousEventHash` equals the immediately
preceding event's hash. Event IDs are unique within the run.

`payloadHash` is ordinary SHA-256 of canonical `data`. `eventHash` is:

```text
H(
  "graph-engineering/subgraph-edge-event/v1alpha1\0",
  completeEventWithEventHashOmitted
)
```

The event-hash preimage includes `payloadHash`, previous hash, plan/root graph
identity, complete scope, type, timestamp, sequence, payload disposition, and
redaction signal. Rehashing one substituted event cannot repair its successor's
previous-hash link or its event-derived checkpoint.

### 11.2 Event types and commit-before-release

The closed event family is:

- invocation created, started, succeeded, failed, cancelled;
- state reducer committed;
- artifact published, read verified, released, failed; and
- stream opened, demand granted, item published, delivered, acknowledged,
  source closed, completed, failed, cancelled.

Key authority boundaries are:

```text
InvocationCreated committed -> child reservation/scope exists
InvocationStarted committed -> child executor may run
StateReducerCommitted committed -> new state may be read
ArtifactPublished committed -> ArtifactRef may cross its edge
StreamItemPublished committed -> item may be delivered
StreamItemAcknowledged committed -> item may be forgotten by active delivery
InvocationSucceeded committed -> projected output may be bound downstream
```

An append failure authorizes none of the action on its right. A stale CAS stops
the coordinator; it is not blindly retried while external work continues.

### 11.3 Normalized trace projection

`subgraph-edge-trace.schema.json` freezes a closed, content-hashed,
metadata-only `NormalizedTrace`. It binds the exact event-stream prefix and
contains deterministic spans/links for run, invocation, reducer, artifact,
stream and future attempt/activity/controller/provider facts. Every span has
explicit nullable identities, causal event range, parent, wall-clock envelope,
run-relative monotonic offsets/duration, terminal state, structured failure,
queue/barrier/retry/backpressure/approval/recovery waits, integer usage/cost/
reservation facts and payload disposition.

The trace retains the inputs needed for a later critical-path calculation and
parallel-utilization view, plus artifact/stream byte and queue/lag high-water
metrics. It does not claim that the offline oracle measured real scheduler
timing. Deterministic fixture offsets are mock-clock evidence only.

External trace export is `off-by-default`. This contract does not implement
OpenTelemetry/JSONL exporters, a Web Explorer, trace retention, query APIs,
critical-path calculation or checkpoint time travel. Those remain under later
observability/Explorer tasks. Exporters and Explorer consume this guarded
public projection rather than private runtime objects and never become event
authority.

### 11.4 Payload-protection boundary

The v1alpha1 fixture uses exact authoritative inline values and therefore
requires:

```text
payloadDisposition: inline-unredacted
redacted: false
```

Hashing those values is not redaction. The current D9 contract work requires
sink-before-write protection and currently denies general artifact sinks and
unknown queue/stream sinks. D4 cannot activate for sensitive data or public
release until a new artifact/stream sink policy, native protected mapping, and
byte-level security conformance exist. A future protected version must use a
new event/checkpoint contract; it cannot replace authoritative values with
lossy redaction tokens while retaining the same hash/version.

## 12. Checkpoints

The checkpoint resource is exactly:

```text
apiVersion: graphengineering.reacher-z.github.io/subgraph-edge-checkpoints/v1alpha1
kind: SubgraphEdgeCheckpoint
contractVersion: subgraph-edge-recovery/v1alpha1
```

It binds run/event-stream/revision/lineage, plan, root graph, last applied
sequence, history-prefix hash, creation time, truthful payload disposition, and
these event-derived projections:

- invocations in creation order, with complete scope/compiled plan, effective
  authority, budget allocation, reuse disposition, status, input hash, and
  terminal projected-output/failure identity;
- reducers with invocation, reducer identity, state version/value/hash, and
  last batch;
- artifacts with complete refs, verified readers, active holds, release fact,
  and current GC eligibility; and
- streams with item schema/topology/byte bounds, status, demand/publish/
  delivery/ack counters, source-close, buffered sequences, and unacknowledged
  sequences; and
- normalized trace identity/hash, through-sequence, open/completed spans,
  dropped count and default-off export fact.

`contentHash` is:

```text
H(
  "graph-engineering/subgraph-edge-checkpoint/v1alpha1\0",
  completeCheckpointWithContentHashOmitted
)
```

Events remain authoritative. Resume first validates the complete event stream,
then accepts a checkpoint only when all are exact:

- run, plan, root graph, sequence, and prefix hash;
- namespace and parent/depth lineage;
- invocation states and terminal hashes;
- reducer state/version/batch fold;
- artifact identity, verification, holds, and lifetime-derived GC flag; and
- stream state, counters, byte bounds, buffers, acknowledgements, and terminal
  status; and
- normalized trace equality to the same authoritative event prefix.

A missing, stale, corrupt, ahead-of-history, foreign-scope, or
projection-inconsistent checkpoint is `GE_D4_CORRUPT_CHECKPOINT` and cannot
authorize work. Implementations may discard it and rebuild from valid events,
but must not use it to hide event corruption. The golden corpus demonstrates
that recomputing `contentHash` after changing a stream counter or reducer value
still fails semantic comparison to the event fold.

## 13. Stable failure surface

Failures are structured values/events with non-sensitive template messages and
retryability. JSON null remains data and never represents one of these failures.

### 13.1 Pre-event plan diagnostics

The offline oracle freezes these plan families:

- graph binding missing/duplicate/order/mismatch;
- root graph missing;
- subgraph call missing/duplicate/unknown graph/wrong node kind;
- projection source missing or target collision;
- undeclared/unused recursion and inconsistent finite limits;
- reducer duplicate/graph missing/state-schema missing/wrong node kind/
  contributor missing/duplicate/self-write/overlap/law/implementation/bounds;
- authority expansion, child over-budget and unordered closed sets; and
- edge binding missing/duplicate/mode/authority/in-flight mismatch.

Plan diagnostics occur before `InvocationCreated` and therefore are not legal
event failure codes for that nonexistent run.

### 13.2 Runtime/recovery codes

The event/checkpoint schemas close these portable codes:

```text
GE_D4_CAPABILITY_UNAVAILABLE
GE_D4_PLAN_INVALID
GE_D4_NAMESPACE_INVALID
GE_D4_RECURSION_LIMIT
GE_D4_PROJECTION_MISSING
GE_D4_PROJECTION_COLLISION
GE_D4_REDUCER_CONFLICT
GE_D4_REDUCER_IDEMPOTENCY_CONFLICT
GE_D4_ARTIFACT_STORE_UNAVAILABLE
GE_D4_ARTIFACT_PUBLICATION_FAILED
GE_D4_ARTIFACT_NOT_FOUND
GE_D4_ARTIFACT_CORRUPT
GE_D4_ARTIFACT_UNAUTHORIZED
GE_D4_ARTIFACT_OVERSIZED
GE_D4_ARTIFACT_EXPIRED
GE_D4_STREAM_DEMAND_EXHAUSTED
GE_D4_STREAM_BUFFER_FULL
GE_D4_STREAM_ITEM_INVALID
GE_D4_STREAM_PROTOCOL
GE_D4_STREAM_CANCELLED
GE_D4_STREAM_FAILED
GE_D4_PAYLOAD_POLICY_UNAVAILABLE
GE_D4_INVALID_HISTORY
GE_D4_CORRUPT_CHECKPOINT
```

`GE_D4_TRACE_INVALID` is the offline normalized-projection/checksum diagnostic;
it is not inserted into an authoritative event that failed to validate.

Language exception classes and explanatory text are not portable. Code, phase,
retryability, identifiers, counters, field presence, and no-write/no-executor
behavior are portable.

For an existing run, byte/envelope and hash-chain corruption wins before
semantic transition checks. After a valid chain is available, namespace,
stream, reducer, artifact, and checkpoint fold rules apply. A stale append CAS
cannot be turned into success by retrying against a different in-memory fold.

## 14. Cross-language conformance projection

TypeScript and Python implementations must independently consume the canonical
plan, events, and checkpoint. Neither may invoke or shell out to the other. A
reporter emits only portable JSON containing at least:

- source graph/compiled-plan hashes, D4 plan, revision and event-stream hashes;
- root/child invocation IDs, namespaces, parents, and depths;
- projected child input and parent output plus their hashes;
- reducer write order, batch ID, state versions, final state/hash, and exact
  idempotent-repeat verdict;
- artifact digest, size, ArtifactRef/artifact ID, verification, holds, lifetime,
  and GC eligibility;
- stream ID, item hashes, demand/publish/delivery/ack counters, high-water
  bounds, redelivery observations, and terminal status;
- ordered event types, every payload/event hash, terminal event hash; and
- complete checkpoint body/content hash;
- normalized trace body/hash, causal links, waits, usage, critical-path inputs,
  byte/high-water metrics and hostile-case codes.

Camel-case fixture fields are the portable wire projection. Native Python may
use snake case internally, but must emit the same machine JSON. Messages, stack
traces, wall-clock timing, task primitives, iterator object types, and store
class names are excluded.

The current offline fixture freezes these golden identities:

```text
rootGraphHash      171369b68a8d534bf2f7aa015537fba200f08fb2dc53c39a7d49e88cc35f931f
childGraphHash     8d48d230dd68aeb79d1d1c55c16b1bbb8b818bcad91bd2d100f586d3fba7ebfd
rootCompiledPlan   d1157e0f410cd194d2301db814343f42b19a28e82ebb814d2e5e0e863d81ecab
childCompiledPlan  f261bce00d58bffd5944e1cd47db6c207f0baa49c9702e14ac2b5f448adb2b84
planHash           2b9e582635d4273ec2ffefb19cbef3a1343451f3c2d8f4f3c6f1b0882180cc4d
rootInvocationId   8a3a50a35ca05d6730e4872c064884cb6f307265f65b44a7181048126ce0c464
childInvocationId  f834d6b7f8e8346e39557571fc839b7fdbd9c8fb2c294bf1415194fd79968e94
reducerBatchId     75a7bc1b880466cbc84c1c8bfa7587f9ab450b50a0595ceb88aa57235753bee8
artifactId         7a94992e0d64bd10376dcc3a1e768e4f40b92d5a0ac7309a31d8348076d64a6d
streamId           f325908f871d9487093498ba431e5b1dd39220fb38f4e771cff0ec1f631edd1f
traceHash          182b8535d07f94e4de72779976cd05757df82cb10a1968e86feb9cdddb8b59c5
terminalEventHash  6eff99f24e2d871679ba52132315aff2830828ba4dfc986b6a3e7a63a3a5b5f2
checkpointHash     5452f429ab844279c9f829f274690bc3632b2d20ce8664e1dcace67731225d88
```

The JavaScript validator is an offline contract oracle. It is not a TypeScript
runtime implementation, a Python implementation, an ArtifactStore, or the
cross-language join required for feature completion.

## 15. Hostile conformance obligations

The checked corpus currently contains:

- five D4 schemas under strict Draft 2020-12 meta-validation/Ajv compilation;
- two exact Graph IR documents bound into one canonical plan;
- two valid plans (canonical plus bounded self-recursion) and seventeen invalid
  semantic plan variants;
- seventeen globally chained, scope-mixed event facts;
- one event-derived terminal checkpoint and one normalized trace;
- seventeen schema-negative mutations;
- twenty-five runtime-semantic cases across projection, recursion, seven
  built-in reducer operations/idempotency, artifact identity/authority/size/
  lifetime, stream demand/bytes/buffering/cancellation, and structured failure;
- eleven hostile event/checkpoint substitutions, including rehashed semantic
  corruption; and
- three hostile normalized-trace substitutions, including rehashed semantic
  drift.

Native package suites must add, without weakening those vectors:

1. cancellation before/after every invocation, reducer, artifact publication,
   stream publish/delivery/ack, and terminal commit boundary;
2. crash/restart after every event with full fold equivalence;
3. concurrent call ordinals, invocation/global reservation races, and stale
   plan/graph substitution;
4. all reducer operations with required/optional failures, JSON null, state
   schema rejection, byte limit, batch retry, and hash-collision injection;
5. artifact store unavailable, partial write, orphan, missing, unauthorized,
   corrupt, lifetime, pinned/unpin, and GC races;
6. zero demand, slow consumer, buffer/unack high-water, item byte/count/global
   exhaustion, redelivery, duplicate/out-of-order ack, source error, target
   error, and non-cooperative cancellation;
7. scope/path/Unicode/pointer/prototype-pollution hostile inputs;
8. foreign/stale/ahead/corrupt checkpoint fallback without hiding event
   corruption; and
9. deterministic full reports from both native runtimes under a hard process
   timeout, with no skipped cases.

## 16. Master-plan and release-gate mapping

This contract is a D4 prerequisite, not completion evidence for later joins.

| Plan/gate | What D4 freezes | What remains Open |
| --- | --- | --- |
| Day 4 scheduler/trace | Namespace, child invocation, reducer, artifact, stream, event, checkpoint, and normalized trace contracts | Native TS/Python execution, scheduler integration, exporters/viewer, deterministic concurrency/resource evidence |
| Graph IR nodes/edges | Exact sidecar binding for `kind: subgraph`, `stateSchema`, `mode: artifact-ref`, and `mode: stream` | A public embedded carrier/API revision, runtime schema execution, native lowering, API freeze |
| Execution primitives | Bounded nested calls, deterministic code reducers, artifact transfer, real-demand stream state machine | Router/barrier/verifier/human/cycle integration and production behavior |
| `X05` event ordering | A D4 event-chain candidate and portable fold | Candidate-bound native event ordering, extended durable join, allowed concurrency-order proof; canonical `REL-X05` remains Open |
| `X08` resume/replay/fork | Resume projection for the same D4 run prefix only | Replay and fork identities, results, bidirectional histories, leases, approval and lineage suite; `REL-X08` remains Open |
| `X10` adapter/storage | Closed ArtifactRef and store requirement names | Event/Checkpoint/Artifact/Lock provider suite, SQLite/PostgreSQL/S3, official adapters and OS matrix; `REL-X10` remains Open |
| `T12` streaming/backpressure | Graph-edge credit, buffer, unacknowledged, cancel, and failure contract | Native Graph IR execution and candidate slow-consumer traces. Existing standalone-pipeline evidence does not prove this edge runtime; release evidence remains candidate-bound/Open |
| `T21` replay/fork | Explicit non-authorizing lineage boundary | Actual replay/fork results, new identities, artifact/stream policy, native parity; `REL-T21` remains Open |
| `T30` storage conformance | Artifact content/ref/lifetime requirements and checkpoint projection | Real ArtifactStore/LockManager, SQLite/PostgreSQL/S3 adapters, races and chaos; `REL-T30` remains Open |

The React Explorer/OpenTelemetry/time-travel surface remains under
`D15-EXPLORER-060`. Artifact stores/workers remain under
`D15-STORAGE-WORKERS-054`. Extended durable recovery/replay/fork remains under
the D9 extension tasks. No D4 document may be cited as their implementation.

## 17. Native implementation handoff

### 17.1 TypeScript lane

The TypeScript owner must add a real, separately exported D4 compiler/runtime
under `packages/core/` and `packages/runtime/` without changing the legacy
`runGraph` result silently. Required work:

1. parse/validate/detach the plan and recompute graph inventories/hashes;
2. negotiate exact capabilities and fail unsupported legacy entrypoints before
   any executor;
3. implement scope/reservation/call/projection lifecycle;
4. implement state validation and all reducers as deterministic code;
5. define authorized ArtifactStore and durable stream interfaces only after D9
   sink policy is accepted;
6. implement commit-before-release event journaling and checkpoint fold;
7. provide deterministic fake stores/sources/consumers for normal tests; and
8. emit the complete normalized reporter without importing Python.

### 17.2 Python lane

The Python owner independently implements equivalent native behavior under
`python/`:

1. strict model projections that preserve absence versus null and reject bool
   as integer where applicable;
2. the same code-point ordering, canonical hashes, pointers, scopes, and plan
   validation precedence;
3. async invocation, reducer, artifact, and stream lifecycles with bounded
   queues and cooperative cancellation;
4. the same event/checkpoint fold and structured codes; and
5. a native reporter that neither invokes Node nor consumes TypeScript output.

### 17.3 Integration, storage, security, and Explorer lanes

The integration owner retains canonical schemas/fixtures and runs the
cross-language join. D9 security must version and accept artifact/stream sinks
before persistence activation. The storage lane supplies real local and
production ArtifactStore/LockManager conformance. The Explorer lane renders
only guarded event-derived projections and never becomes authority.

## 18. Current audit disposition

The machine contract itself has no known open shape/fold P0 or P1 after the
included hostile oracle passes. Product completion remains blocked:

### P0 — release blocking

1. Existing TS/Python schedulers do not negotiate D4 and can treat non-strict
   stream/artifact edges as ordinary values.
2. Neither native runtime implements nested invocation, projections, reducers,
   D4 journaling, checkpoint fold, or the D4 reporter.
3. There is no ArtifactStore/LockManager or D9-approved artifact/stream sink
   policy/implementation.
4. There is no durable Graph IR stream scheduler, item recovery, or native
   backpressure/cancellation join.
5. There is no independent native TS/Python executable conformance result.

### P1 — integration blocking

1. Graph IR/public API has no embedded or referenced D4 plan carrier; the
   sidecar is deliberately not a frozen public runtime API yet.
2. Native replay/fork, leases, multi-process ownership, and production stores
   are absent; the carrier alone is not execution.
3. Explorer/OpenTelemetry/critical-path computation/time-travel implementations
   are absent; only the normalized metadata carrier is frozen.
4. General runtime JSON Schema input/output/state validation remains part of
   native implementation work.

### P2 — later hardening

1. A protected future artifact identity may need keyed semantic identity to
   avoid low-entropy digest disclosure; this requires a new version.
2. Large nested plans need accepted compile/fold performance and memory
   baselines without weakening bounds.
3. Multicast streams, joins, windows, watermarks, durable spill, and richer
   reducer plugins require separately versioned contracts rather than extension
   fields in v1alpha1.

`D4-TRACE-SUBGRAPH-022` therefore remains in progress after this contract
candidate. It can close only after both native implementations, shared
executable conformance, docs/examples, independent review, immutable commit,
and candidate-bound evidence exist.

## 19. Acceptance checklist

Before any public capability table changes from vocabulary/contract-only to
implemented, reviewers must verify all of the following:

- every schema and fixture has strict duplicate-key JSON, Draft 2020-12, and
  strict Ajv evidence;
- the plan binds the exact compiled Graph IR bytes and fails unmatched advanced
  nodes/edges;
- all capabilities and D9 sink policies negotiate before executor/store/source
  work;
- namespace, parent, depth, recursion, call ordinal, and checkpoint isolation
  survive crash/restart;
- required/optional projections preserve missing versus JSON null;
- reducer conflicts, declared algebra, all seven built-ins plus the
  content-addressed custom boundary, byte/schema
  validation, exact idempotency, and crash windows pass;
- artifact publication/read/lifetime/GC/errors pass against every official
  store without treating hashes as authority/protection;
- stream demand, buffer, unacknowledged, item/global bounds, cancellation,
  failure, redelivery, and cleanup pass without a false barrier or silent null;
- event sequence/hash/scope/fold, checkpoint equivalence, and normalized trace
  projection pass hostile mutations in both languages;
- TS and Python normalized reports are byte-equivalent with no delegation or
  skipped case;
- Explorer/export/log/support projections are guarded and remain non-authority;
- replay/fork and storage release rows remain Open unless their own complete
  candidate evidence exists; and
- documentation explicitly distinguishes contract, local fake evidence,
  native implementation, production store support, and released availability.

Only that complete evidence chain turns Graph IR vocabulary into trustworthy
execution.
