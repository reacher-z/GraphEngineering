# D4-TRACE-SUBGRAPH-022 contract audit — 2026-07-26

## Decision

**Disposition: ACCEPT FOR NATIVE HANDOFF AS A CONTRACT CANDIDATE; DO NOT CLOSE
THE D4 TASK OR ANY RELEASE LEAF.**

The D4-owned schema, fixture, semantic oracle, and normative prose form a
closed offline contract candidate with no known shape/fold P0 or P1 after the
listed checks. This is not native implementation evidence. Under the master
plan state taxonomy, `D4-TRACE-SUBGRAPH-022` remains `in_progress`: native
TypeScript, native Python, the cross-language executable join, storage,
security, Explorer, packaging, and candidate evidence are still absent.

This report is a producer self-audit with a separate main/integration-agent
gate rerun. It is not the independent hostile reviewer signature required to
move a security-sensitive contract to accepted or candidate Green.

## Scope and ownership

The D4 lane created only these dedicated paths:

- `spec/subgraph-and-edge-semantics.md`
- `spec/subgraph-edge-plan.schema.json`
- `spec/artifact-ref.schema.json`
- `spec/subgraph-edge-event.schema.json`
- `spec/subgraph-edge-checkpoint.schema.json`
- `spec/subgraph-edge-trace.schema.json`
- `spec/conformance/subgraph-edge.case.json`
- `spec/conformance/subgraph-edge.validate.mjs`
- this review report

It did not edit the task registry, master plan, release map/checklist, shared
fixture validator, `spec/README.md`, existing architecture documents, native
TypeScript/Python runtimes, ArtifactStore, or Explorer paths.

## Canonical material read

The audit read the complete original 368-line plan and the append-only
expansion through line 3164. It specifically re-attacked the contract against:

- §9 state/evidence/dependency laws and the no-skip chain;
- §10 Graph IR identities, closed node kinds, typed-port and immutable-plan
  requirements;
- §11 native scheduler, real pipeline/backpressure and failure algebra;
- §13.1 nested subgraphs;
- §13.2 concurrent state reducers;
- §13.3 artifact references;
- §13.4 executable stream edges;
- §13.5 normalized trace;
- §13.6 D4 acceptance boundary;
- §14 event/checkpoint/replay/fork/storage authority;
- §15 truthful payload disposition, sink inventory and capability ceilings;
- §16 nested budget reservations;
- §20 public observability/Explorer consumer boundary;
- §23 test taxonomy, hostile/property/fault/portability obligations;
- §26.4 Wave C entry/exit criteria;
- §27 release-family no-omission joins; and
- §29 final independent no-omission protocol.

It also read the 192-line delivery coverage matrix, the 577-line exhaustive
gap audit, the exact task-registry record, Graph IR/runtime/persistence/
cross-language architecture, durable and pipeline semantics, D7 reviews, D9
redaction review, and current TypeScript/Python compiler/scheduler/durable
implementations.

## Contract closure delivered

### Nested subgraph

- exact graph, compiled-plan, revision, plan, run, invocation and namespace
  identities;
- deterministic RFC 6901 logical namespace and isolated checkpoint scope;
- explicit input and named-output projection with absence distinct from null;
- SCC-based recursion detection with shared group/bound and global depth/call
  bounds;
- deny-by-default parent authority, exact child intersection and narrower
  budget reservation;
- parent/child cancellation and failure propagation, non-cooperative in-doubt
  treatment, exact-success reuse rule, read-only replay and re-authorized fork
  carriers; and
- explicit artifact/stream boundary-transfer rules.

### State reducers

- state-schema identity, initial-state rule, writer inventory, overlap
  rejection, reducer implementation/version/law and exact-batch identity;
- built-in ordered replace, ordered append, disjoint merge, set union by hash,
  bounded integer sum/min/max, plus a content-addressed authority-free custom
  transform boundary;
- state/update byte bounds, schema validation-before-CAS, state versions,
  replay/fork projection and sink-policy requirement; and
- hostile law, implementation, numeric-bound, overlap, ordering, collision and
  idempotency vectors.

### Artifact reference

- raw-byte SHA-256/size/media identity separated from artifact and capability
  identities;
- closed store/namespace/tenant/run/logical-name/provenance/task/attempt fields;
- truthful test-only-unprotected versus protected-reference carrier;
- retention, lifetime, hold/GC, capability actions/authority/expiry;
- atomic finalize, bounded orphan cleanup, tenant-safe dedupe, fatal collision,
  verify-on-read, replay/fork sharing and support/export policy; and
- structured unavailable/publication/missing/corrupt/unauthorized/oversized/
  expired boundaries without null substitution.

### Stream edge

- explicit one-to-one topology and item-schema hash; multicast/partition/merge
  are unsupported rather than implied;
- source order, explicit demand, bounded buffer/unacknowledged/items/item bytes/
  aggregate in-flight bytes;
- item and delivery-attempt identities, terminal frames, late-item rejection,
  optional authorized artifact spill, per-frame checkpoint boundary and
  duplicate suppression;
- cancellation/failure/redelivery state, no array materialization or false
  barrier; and
- queue depth, blocked time, throughput and lag trace metrics.

### Event, checkpoint, and normalized trace

- one global event sequence/hash chain across nested scopes with event-stream,
  revision, lineage, compiled-plan, monotonic-offset and trace context binding;
- commit-before-release facts for invocation, reducer, artifact and stream;
- an event-derived checkpoint containing authority/budget/reuse, reducer,
  artifact, stream byte/counter and normalized-trace acceleration state;
- metadata-only normalized spans/links with all required nullable identities,
  causal sequences, wall/monotonic timing, waits, integer usage/cost/reservation,
  failures, critical-path inputs and utilization/byte/high-water inputs; and
- external export off by default. OTel and Explorer remain consumers, never
  event authority.

## Machine corpus

The standalone oracle currently proves:

- 5 strict Draft 2020-12 D4 schemas;
- 2 exact Graph IR source documents and their graph/compiled-plan hashes;
- 1 canonical plan plus 18 semantic variants;
- 17 globally chained nested-scope events;
- 1 event-derived terminal checkpoint;
- 1 normalized metadata-only trace;
- 17 schema-negative mutations;
- 25 runtime-semantic cases;
- 11 hostile history/checkpoint mutations; and
- 3 hostile trace mutations, including rehashed semantic drift.

The fixture goldens bind plan, revision, stream, invocation, reducer, artifact,
capability, trace, terminal-event and checkpoint identities. The JavaScript
oracle is deterministic code; it does not count as either native runtime.

## Existing native nonconformance evidence

### TypeScript

`packages/runtime/src/scheduler.ts:195`–`217` binds every incoming edge by
reading the predecessor terminal output. It does not branch on `edge.mode`.
`settle` at lines 744–755 releases all outgoing edges identically. A
`kind: subgraph` node is selected from the ordinary executor registry rather
than recursively executing a bound child plan. There is no D4 plan/capability
negotiation, reducer state machine, ArtifactStore, stream descriptor, D4 event
fold/checkpoint, or normalized trace reporter.

### Python

`python/src/graph_engineering/scheduler.py:352`–`370` likewise maps every
incoming edge to its predecessor terminal value without inspecting edge mode;
`settle` at lines 823–831 releases every outgoing edge identically. A subgraph
kind resolves through the ordinary handler registry. There is no native D4
plan negotiation, nested scheduler scope, reducer, ArtifactStore, async Graph
IR stream edge, D4 history/checkpoint, or normalized trace reporter.

An earlier focused deterministic probe in both runtimes produced the same
nonconformant shape: the artifact consumer received the predecessor value under
`artifact`, and the stream consumer received it under `items`. That agreement
is evidence of shared legacy behavior, not D4 parity. The contract therefore
requires a new negotiated entrypoint to fail closed on unsupported legacy
runtimes rather than silently preserving this behavior.

## P0 — release blocking

1. Neither native runtime executes the D4 plan or negotiates its capability,
   authority, budget, protection, store and stream requirements.
2. Neither runtime executes a nested child plan with isolated scope, projected
   input/output, bidirectional cancellation/failure and committed child events.
3. Neither runtime implements reducer validation/CAS/idempotency or all closed
   reducer kinds.
4. No D9-approved artifact/state/stream sink policy or native sink-before-write
   mapping exists; the fixture is explicitly unprotected test-only.
5. No ArtifactStore/LockManager/local store implementation exists for this
   contract; no verify/finalize/orphan/retention/race suite exists.
6. No durable Graph IR stream scheduler provides real demand/backpressure,
   in-flight-byte enforcement, cancellation, redelivery and recovery.
7. Neither runtime emits/folds D4 events, checkpoints or normalized trace.
8. There is no executable native TS-versus-Python byte-equality report and no
   independent hostile acceptance review.

## P1 — integration blocking

1. Graph IR/public SDK has no reviewed embedded/reference carrier for the D4
   sidecar; API freeze remains Open.
2. Native replay/fork, leases/fencing, multi-process ownership and complete
   durability are absent; frozen lineage fields are not execution.
3. Runtime JSON Schema input/output/state/item validation profiles remain to be
   integrated in both languages.
4. OTel/JSONL exporters, critical-path calculation, Explorer backend/frontend,
   time travel and live update are absent; only their public input carrier is
   frozen.
5. Docs/examples/patterns/CLI/SDK/MCP/package installed-artifact evidence and
   candidate portability/performance/security evidence remain absent.

## P2 — later version/hardening

1. A protected artifact version may need keyed semantic identity to avoid
   low-entropy digest equality disclosure.
2. Large nested plans/folds need accepted memory/time/property/fuzz baselines.
3. Multicast, partition, merge, windows, watermarks, durable spill and richer
   reducer plugins require a new version, not v1alpha1 extension fields.

## Release and downstream Open ledger

| Join | Frozen here | Still Open |
| --- | --- | --- |
| Day 4 / Wave C | Contract carriers and offline oracle | Native TS/Python plus executable join |
| `REL-X05` | D4 event-order/hash candidate | Candidate native ordering and extended durable join |
| `REL-X08` | Lineage/replay/fork carrier | Native replay/fork results, leases, approval and bidirectional history |
| `REL-X10` | Artifact/store interface requirements | Official Event/Checkpoint/Artifact/Lock/storage adapters and OS matrix |
| `REL-T12` | Demand/buffer/unack/in-flight contract | Native slow-consumer/pull-ahead/backpressure traces |
| `REL-T21` | Non-authorizing lineage rules | Actual replay/fork identities/results and native parity |
| `REL-T30` | Artifact/checkpoint storage projections | Local/SQLite/PostgreSQL/S3/Lock conformance, races and chaos |
| D9 security | Future sink policy names and truthful fixture disposition | Accepted policies, native redaction/protection and byte canary join |
| D15 storage/workers | Stable carrier handoff | ArtifactStore/LockManager, workers and production stores |
| D15 Explorer | Metadata-only normalized trace input | exporters, query backend, React UI, accessibility/security/performance |

All listed release rows remain **Open**. No D4 file may be used to turn a
release checklist row Green.

## Exact validation commands

All commands run from `/home/nick/work/GraphEngineering`:

```text
python3 - <<'PY'
import json
from pathlib import Path
paths = [
  Path('spec/subgraph-edge-plan.schema.json'),
  Path('spec/artifact-ref.schema.json'),
  Path('spec/subgraph-edge-event.schema.json'),
  Path('spec/subgraph-edge-checkpoint.schema.json'),
  Path('spec/subgraph-edge-trace.schema.json'),
  Path('spec/conformance/subgraph-edge.case.json'),
]
def reject(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f'duplicate key: {key}')
        out[key] = value
    return out
for path in paths:
    json.loads(path.read_text(), object_pairs_hook=reject)
print(f'duplicate-key strict parse passed: {len(paths)} JSON files')
PY

jq empty spec/subgraph-edge-plan.schema.json spec/artifact-ref.schema.json \
  spec/subgraph-edge-event.schema.json spec/subgraph-edge-checkpoint.schema.json \
  spec/subgraph-edge-trace.schema.json spec/conformance/subgraph-edge.case.json

node --check spec/conformance/subgraph-edge.validate.mjs
node spec/conformance/subgraph-edge.validate.mjs
corepack pnpm validate:fixtures
corepack pnpm check:docs
git diff --check -- spec/subgraph-and-edge-semantics.md \
  spec/subgraph-edge-plan.schema.json spec/artifact-ref.schema.json \
  spec/subgraph-edge-event.schema.json spec/subgraph-edge-checkpoint.schema.json \
  spec/subgraph-edge-trace.schema.json spec/conformance/subgraph-edge.case.json \
  spec/conformance/subgraph-edge.validate.mjs \
  codex_logs/reviews/D4-TRACE-SUBGRAPH-022-contract-audit-2026-07-26.md
```

Expected dedicated-oracle terminal line:

```text
Validated 5 D4 schemas, 2 bound graphs, 1 canonical plan plus 18 semantic plan variants, 17 chained events, 1 event-derived checkpoint, 1 normalized trace, 17 schema negatives, 25 runtime-semantic cases, 11 hostile history/checkpoint cases, and 3 hostile trace cases.
```

The main/integration agent separately reran the dedicated syntax/oracle,
documentation (240 links), and diff-check gates successfully before this report.

## File digests before this report

```text
cea2cae97b517f44b81b8dd0d932b6a34f0b81115f71597c491dbb335d13b3af  spec/subgraph-and-edge-semantics.md
4843edf53055b09bf61918a8902bfc9cb020a2774f3b33624e05740fcd32a87b  spec/subgraph-edge-plan.schema.json
dd6b3ac3309e99d7eb5abb8db7cde71728dc089fa134a2bc9e1136d08dda0c88  spec/artifact-ref.schema.json
6034ad591501a91cb13630feb733f83c7ebd625e6c53f0b2c3085c2d826840d1  spec/subgraph-edge-event.schema.json
bf4b1fef3e28a39002721c53eadca29b45a0905717a1de01555b68caf3942967  spec/subgraph-edge-checkpoint.schema.json
d1f80617d627808bf9246984963335af15bdab62704e616090856d638915110d  spec/subgraph-edge-trace.schema.json
cf2c4bba7d979ddef53715fea6468872c92f9663422e224169b42e0ccc270f1a  spec/conformance/subgraph-edge.case.json
e856148ed3ecefbd51dc63dab41922c7ba4438a7fbe4504ea0b59330ad0ff98b  spec/conformance/subgraph-edge.validate.mjs
```

These digests identify the contract bytes immediately before adding this audit
report. Integration must recompute them after any subsequent edit and must not
reuse this report as evidence for changed bytes.

## Handoff order

1. Main/integration obtains an independent hostile contract review and freezes
   the accepted schema/fixture digests.
2. Disjoint TypeScript and Python lanes implement the same frozen contract
   without editing fixtures or delegating to the other language.
3. Integration runs native reports and compares exact canonical bytes, hashes,
   diagnostics, events, checkpoints, trace, outputs, failures and zero-dispatch
   replay observations.
4. D9 accepts sink/protection policies before real artifact/stream persistence.
5. Storage implements local/production ArtifactStore and LockManager through a
   shared conformance kit.
6. Explorer/exporters consume only guarded normalized trace projections.
7. Only immutable candidate evidence and an independent review may change task
   or release status.

No commit or push was made by this lane. Main/integration owns shared status,
commit selection, detached revalidation, push, and remote-SHA verification.
