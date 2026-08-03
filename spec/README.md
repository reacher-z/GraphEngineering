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
The post-B2 authority handoff, final v2 identities, single fixed cursor update,
rules 11/12, crash split and prohibition on an independently committed rebind
are frozen by
[sqlite-cursor-publication-rebind-v2.md](sqlite-cursor-publication-rebind-v2.md).
That B3 contract is a subprotocol inside the one-commit v1-to-v2 migration. Its
initial-publication boundary fixes a 34-object authority graph, atomic
outer-authority mint, exact 20-statement `0002` execution without Python
`executescript()`, four ordered write receipts with a three-dimensional ledger,
a post-DDL reader lease, atomic retry-or-poison adoption, 145 hostile
obligations and a 28-field TypeScript/Python parity record. It retains all
implementation, protocol, production-throughput, active-manifest and release
claims as false. The exact frozen fixture is domain-separated and anchored at
SHA-256
`32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993`;
the JSON Schema also contains a recursively exact, null-prototype-safe frozen
instance tree, so schema acceptance cannot be widened into semantic drift.
These D7 schemas are protocol-frozen and consumed by the native TypeScript and
Python standalone alpha controllers. Schema acceptance alone is not native or
production evidence; executable conformance remains the capability gate. Their
v1alpha1 authoritative payloads are explicitly inline-unredacted and therefore
do not satisfy the still-open D9 protected-payload or stable-release gate.

The future single `BEGIN EXCLUSIVE` owner, its monotonic failure/success
arbiter, complete 30-stage publication order, final-fence-only COMMIT authority,
commit-ambiguity partition, and exact reopen classifier are frozen as a
contract-only redbar by
[sqlite-cursor-publication-transaction-owner-v1.md](sqlite-cursor-publication-transaction-owner-v1.md).
Its 32 future target scenarios are explicitly not runtime evidence: no runtime
transaction control, driver-native throw, crash/reopen, public API, protocol,
or release claim is active.

Scheduler-integrated conditional routing, its compiler diagnostics and its
`routedBranches` lowering are frozen by
[integrated-router-semantics.md](integrated-router-semantics.md). The remaining
D6 surface — integrated barriers, quorum, abstention, deadlines, the closed
`onUnsatisfied` resolution set, late arrival, cancellation propagation, and
durable zero-rejudge decision replay for both routers and barriers — is frozen
by [integrated-barrier-semantics.md](integrated-barrier-semantics.md). Its
machine-readable carriers are
[integrated-barrier-policy.schema.json](integrated-barrier-policy.schema.json),
[barrier-vote.schema.json](barrier-vote.schema.json),
[barrier-decision.schema.json](barrier-decision.schema.json), and
[route-decision.schema.json](route-decision.schema.json). The barrier contract
carries `implementationClaim: false`: no runtime implements it yet, and until
one does, both runtimes must reject a barrier node bearing an exact policy
before dispatch rather than executing it as an ordinary transform, because a
silently passed unsatisfied barrier is the exact defect the contract exists to
prevent.

Durable payload protection, the v1alpha1 `redacted` truth hotfix, the closed
57-source/54-sink capture inventories, the JSON Pointer redaction transform, and
the sink-before-write guard are fixed by
[redaction-semantics.md](redaction-semantics.md). Its fourteen machine carriers
are [capture-source.schema.json](capture-source.schema.json),
[capture-sink.schema.json](capture-sink.schema.json),
[capture-policy.schema.json](capture-policy.schema.json),
[redaction-rule.schema.json](redaction-rule.schema.json),
[redaction-receipt.schema.json](redaction-receipt.schema.json),
[payload-disposition.schema.json](payload-disposition.schema.json),
[protected-value.schema.json](protected-value.schema.json),
[protected-blob.schema.json](protected-blob.schema.json),
[protected-aad.schema.json](protected-aad.schema.json),
[protected-store-envelope.schema.json](protected-store-envelope.schema.json),
[sink-guard-decision.schema.json](sink-guard-decision.schema.json),
[event-v1alpha2.schema.json](event-v1alpha2.schema.json),
[checkpoint-v1alpha2.schema.json](checkpoint-v1alpha2.schema.json), and
[redaction-conformance.schema.json](redaction-conformance.schema.json), with the
adversarial corpus at [conformance/redaction.case.json](conformance/redaction.case.json)
and its executable validator at
[conformance/redaction.validate.mjs](conformance/redaction.validate.mjs). The
corpus carries `implementationClaim: false`. What is *not* implemented: neither
native runtime protects, redacts, classifies, or guards anything. There is no
`ProtectedPayloadStore`, no `KeyProvider`, no sink-before-write guard, no
redaction transform, and no capture policy in either runtime. The v1alpha2 event
and checkpoint envelopes are contracts only; the runtimes still write the
v1alpha1 shapes. Of the 106 `semanticCases`, twenty-six are executed today (the
twenty-four portable-limit cases and two pointer cases); the remaining eighty
declare symbolic mutation operators with no interpreter, and the 3,078-pair
source×sink domain is exercised by the thirty-nine `flowCases` rather than
materialized. Existing v1alpha1 JSONL journals and checkpoints must still be
treated as containing plaintext application data.

Portable budget vectors, ceilings, reservations, the pricing snapshot, the model
router policy, and the append-only budget ledger are fixed by
[budget-semantics.md](budget-semantics.md). Its machine carriers are
[budget-vector.schema.json](budget-vector.schema.json),
[budget-policy.schema.json](budget-policy.schema.json),
[pricing-snapshot.schema.json](pricing-snapshot.schema.json),
[model-router-policy.schema.json](model-router-policy.schema.json),
[model-route-decision.schema.json](model-route-decision.schema.json),
[budget-ledger-event.schema.json](budget-ledger-event.schema.json), and
[budget-ledger-checkpoint.schema.json](budget-ledger-checkpoint.schema.json),
with the corpus at [conformance/budget.case.json](conformance/budget.case.json)
and its validator at
[conformance/budget.validate.mjs](conformance/budget.validate.mjs). The corpus
carries `implementationClaim: false`. What is *not* implemented: no runtime
meters, reserves, settles, or denies against a budget, and no runtime consults a
pricing snapshot or model router policy. The validator is CI-wired but is not
yet a complete rule engine — several of its checks are pinned by frozen golden
hashes rather than by independently reproducible semantic rules, so a
second-language runtime with its own goldens would have no rule to fail. Scope
ceilings and route-bound reservation coverage are not enforced, and several hash
domains used by the oracle are undocumented in the specification.

Nested subgraph scopes, deterministic reducers, artifact references, durable
stream edges, and event/checkpoint/trace lineage are fixed by
[subgraph-and-edge-semantics.md](subgraph-and-edge-semantics.md). Its machine
carriers are [artifact-ref.schema.json](artifact-ref.schema.json),
[subgraph-edge-plan.schema.json](subgraph-edge-plan.schema.json),
[subgraph-edge-event.schema.json](subgraph-edge-event.schema.json),
[subgraph-edge-checkpoint.schema.json](subgraph-edge-checkpoint.schema.json), and
[subgraph-edge-trace.schema.json](subgraph-edge-trace.schema.json), with the
corpus at [conformance/subgraph-edge.case.json](conformance/subgraph-edge.case.json)
and its validator at
[conformance/subgraph-edge.validate.mjs](conformance/subgraph-edge.validate.mjs).
The corpus carries `implementationClaim: false`. What is *not* implemented: no
runtime executes a nested subgraph invocation, a deterministic reducer, an
artifact-ref edge, or a durable stream edge; `runtime-capability-semantics.md`
still requires both runtimes to reject `stream` and `artifact-ref` edge modes
before dispatch. The validator is CI-wired but is closer to a single-instance
golden pin than a rule engine: several of its own guards have no fixture
coverage, artifact authorization (capability expiry, media type, size, lifetime
mode) is largely unevaluated, and the terminal-state and source-closed stream
guards have known gaps. Treat it as shape and lineage evidence only.

Canonical human approval — authority ceilings, scope narrowing, the stable
idempotency key, stale-decision rejection, and the barrier discharge path — is
fixed by [approval-semantics.md](approval-semantics.md). Its machine carriers
are [approval-authority.schema.json](approval-authority.schema.json),
[approval-request.schema.json](approval-request.schema.json), and
[approval-grant.schema.json](approval-grant.schema.json); the discharge path
reuses the frozen
[barrier-decision.schema.json](barrier-decision.schema.json) rather than
minting a second decision carrier. The corpus is at
[conformance/approval.case.json](conformance/approval.case.json) and its
validator at
[conformance/approval.validate.mjs](conformance/approval.validate.mjs). The
corpus carries `implementationClaim: false`. What is *not* implemented: neither
runtime issues, presents, validates, or honours an approval. There is no
approval issuer, no approver surface, no grant validator, no ledger fold, and
no discharge path in this repository, and because no runtime implements
integrated barriers either, the discharge path of the contract has no reachable
producer. No signature, PKI, or attestation of the approver exists:
`approverPrincipal` is a name checked against an allowlist, so the contract
makes forgery of the *binding* detectable and does **not** make impersonation
of the *approver* detectable. No multi-approver quorum, delegation, escalation,
transport, notification, or timeout scheduling is defined. `event.schema.json`
is unchanged, so `HumanInputRequested.data` and `HumanInputReceived.data`
remain open objects on the wire.

Durable-runtime extension — lease and fence authority, read-only replay, fork
lineage, the artifact-store and lock-manager boundaries, and disposable
checkpoint acceleration — is fixed by
[durable-extension-semantics.md](durable-extension-semantics.md). Its five
machine carriers are [lease.schema.json](lease.schema.json),
[replay-plan.schema.json](replay-plan.schema.json),
[fork-lineage.schema.json](fork-lineage.schema.json),
[artifact-store-descriptor.schema.json](artifact-store-descriptor.schema.json),
and [checkpoint-acceleration.schema.json](checkpoint-acceleration.schema.json),
with the corpus at
[conformance/durable-extension.case.json](conformance/durable-extension.case.json)
and its validator at
[conformance/durable-extension.validate.mjs](conformance/durable-extension.validate.mjs).
The corpus carries `implementationClaim: false` and
`contractStatus: contract-only-native-implementation-required`. What is *not*
implemented: no runtime acquires or fences a lease, executes a read-only
replay, forks a lineage, resolves an artifact store, or accelerates a
checkpoint. The shipped CycleStore provider renews leases without counting
renewals or binding a policy identity, and its `leaseEpoch` and `fencingToken`
are always equal, so adopting this contract's `renewalCount`, `renewalLimit`,
`policyId`, `policyHash` and independent fence changes `GE_CYCLE_STORE_*` wire
bytes; that migration is unperformed. The validator's guard-neutralization
sweep is a separate measurement path (`GE_DX_MEASURE=1` on the validator's own
CLI) and is deliberately not run by `validate-fixtures`.

Capability manifests, authority narrowing, resolved-path policy, git worktree
leases, restricted process and container launch, the isolation provider
boundary, and the safe merge gate are fixed by
[isolation-semantics.md](isolation-semantics.md). Its machine carriers are
[capability-manifest.schema.json](capability-manifest.schema.json),
[isolation-provider.schema.json](isolation-provider.schema.json),
[worktree-lease.schema.json](worktree-lease.schema.json), and
[merge-gate-decision.schema.json](merge-gate-decision.schema.json), with the
corpus at [conformance/isolation.case.json](conformance/isolation.case.json)
and its validator at
[conformance/isolation.validate.mjs](conformance/isolation.validate.mjs). The
corpus carries `implementationClaim: false` and an `ambientAuthority` block
asserting `runtimeHasAmbientAuthority: true`; the validator fails hard if
either is edited, so the only way to stop this corpus from saying "nothing is
implemented" is to make the gate red. What is *not* implemented: no runtime
derives or enforces a capability manifest, no isolation provider exists, no
worktree is leased or cleaned up, no process or container limit is applied, and
no merge gate runs. Graph IR `resources`, `isolation` and `sideEffects` remain
opaque declarations — a capability manifest committed beside a graph changes
nothing at execution time. Freezing this contract is contract-level evidence
only; it is not a security claim, and the Day 12 gate remains open. The
document also discloses that one of its 129 rejection rules
(`deriveBranch`'s forbidden-git-ref check) has no isolating vector.

Rubrics, verdicts, judge panels, citation claims, reflection bounds, quorum,
and the unknown state are fixed by
[verification-semantics.md](verification-semantics.md). Its machine carriers
are [rubric.schema.json](rubric.schema.json),
[verdict.schema.json](verdict.schema.json),
[judge-panel.schema.json](judge-panel.schema.json),
[citation-claim.schema.json](citation-claim.schema.json), and
[reflection-record.schema.json](reflection-record.schema.json); it composes
with the frozen [barrier-vote.schema.json](barrier-vote.schema.json) and
[barrier-decision.schema.json](barrier-decision.schema.json) rather than
redefining them. The corpus is at
[conformance/verification.case.json](conformance/verification.case.json) and
its validator at
[conformance/verification.validate.mjs](conformance/verification.validate.mjs).
The corpus carries `implementationClaim: false`. What is *not* implemented: no
runtime evaluates a rubric, retains a ballot, computes a panel census, verifies
a citation, or bounds a reflection. No provider, model, network, or wall clock
participates, so nothing here is evidence that verification works against a
real model. Human-gate *resumption* is unspecified and owned by
`D9-APPROVAL-077`; budget units are bounded but never accounted; maker/verifier
context isolation is a declared hash-inequality obligation the contract cannot
verify and cannot detect a forgery of; citation verification runs only against
frozen local sources and the `networkVerification: "bounded"` mode is never
exercised. The corpus discloses that two of its 179 guards (`Q010`, `X009`)
survive neutralization — they have no isolating vector — and the survivability
sweep itself is a separate measurement path on the validator's own CLI, not
part of `validate-fixtures`.

Provider and tool adapters — capability discovery, structured output and tool
calls, streaming, usage accounting, and the retry/rate/circuit/fallback/cancel
ladder — are fixed by [adapter-semantics.md](adapter-semantics.md). Its machine
carriers are
[adapter-capability.schema.json](adapter-capability.schema.json),
[adapter-descriptor.schema.json](adapter-descriptor.schema.json),
[adapter-error.schema.json](adapter-error.schema.json), and
[adapter-usage.schema.json](adapter-usage.schema.json), with the corpus at
[conformance/adapter.case.json](conformance/adapter.case.json) and its
validator at
[conformance/adapter.validate.mjs](conformance/adapter.validate.mjs). The
corpus carries `implementationClaim: false` and
`evidenceClass: deterministic-mock`, and asserts `credentialRequired: false`,
`networkAccess: false`, `wallClockDependence: false`, `injectedClockOnly: true`.
What is *not* implemented: no runtime in this repository implements this
contract — there is no TypeScript adapter and no Python adapter. No provider
integration exists; `openai`, `anthropic`, `google-gemini` and
`openai-compatible` name intended boundary shapes, not working clients, and no
request has ever been sent to any of them by this code. Even the deterministic
`mock` adapter is unimplemented: the corpus is a fixture, not a running
adapter. It proves internal consistency and composition with the frozen budget
([budget-vector.schema.json](budget-vector.schema.json)) and cycle
([cycle-controller.schema.json](cycle-controller.schema.json)) contracts, and
nothing about any provider.

The five contracts above use their own stable `GE_APPROVAL_*`, `GE_DX_*`,
`GE_CAP_*`, `GE_ISO_*`, `GE_MERGE_*` and `GE_ADAPTER_*` diagnostic vocabularies,
enumerated and frozen in their own semantics documents and corpora. They are
deliberately not listed under "Compiler diagnostic codes" below: that list is
scoped to the `GE1xxx` codes emitted by compiler passes, and the `D9`, `D10`
and `D4` runtime vocabularies are scoped the same way.

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
- `GE1401_INVALID_ROUTER_POLICY`
- `GE1402_UNSUPPORTED_EDGE_CONDITION`
- `GE1403_CONDITION_SOURCE_NOT_ROUTER`
- `GE1404_ROUTE_NOT_ALLOWED`
- `GE1405_DUPLICATE_ROUTE_CASE`
- `GE1406_DUPLICATE_ROUTE_TARGET`
- `GE1407_INCOMPLETE_ROUTE_COVERAGE`
- `GE1421_INVALID_BARRIER_POLICY`
- `GE1422_BARRIER_POLICY_KIND_MISMATCH`
- `GE1423_BARRIER_NO_INPUTS`
- `GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS`

`GE1401` through `GE1407` are emitted by the integrated router pass and
`GE1421` through `GE1424` by the integrated barrier pass. The router pass runs
before the barrier pass, and both run after graph policies and before strict
typed ports.

Compilers may attach language-specific explanatory messages and source
locations, but conformance tests compare the stable diagnostic code and
associated node/edge identifiers.
