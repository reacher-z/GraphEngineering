# D7 cycle-controller machine-contract closure

- Task: `D7-CYCLE-SPEC-024`
- Recorded at: `2026-07-26T22:01:50Z`
- Integration HEAD observed during final verification:
  `dd8c0f7a159a717fc4cd75a5c9b3d90451433a93`
- Implementer disposition: **P0-01 and P0-02 protocol layers closed; D7 task
  remains open because P0-03 native execution/conformance is not implemented**
- Registry/branch/commit changes: none by this work package

## Scope and honesty boundary

This work package completed only the canonical D7 specification, schema,
fixture, offline validation, and boundary-document layer. It did not add a
TypeScript controller, Python controller, native GraphPatch compiler/applier,
runtime store integration, CLI capability, or cross-language execution
reporter. The existing immutable-DAG schedulers and static `loopUntilDry`
pattern are not counted as dynamic-cycle evidence.

`cycle-controller-recovery/v1alpha1` is deliberately a separate protocol. It
does not alter or reinterpret `scheduler-recovery/v1alpha1`, `event.schema.json`,
or `checkpoint.schema.json`.

## Former P0-01 — machine-readable carrier and controller/result schema

Protocol closure evidence:

1. [`cycle-controller-policy.schema.json`](../../spec/cycle-controller-policy.schema.json)
   freezes one closed, fully resolved effective policy. Every duration, cost,
   attempt, discovery, dynamic-node, candidate-count, item-byte, and batch-byte
   limit is explicit; mode-specific dry-round fields are conditional and there
   is no unbounded sentinel.
2. [`cycle-controller.schema.json`](../../spec/cycle-controller.schema.json)
   freezes the standalone public `CycleControllerRequest`. It binds the
   controller to a host run, separate event stream/checkpoint scope, objective,
   identities, implementation, truthful payload profile, exact initial graph
   revision, activity implementations and worst-case bounds, patch limits, and
   start/fork lineage.
3. The carrier is explicitly `standalone-child-controller`. `graph.schema.json`
   was not modified, and free-form node config, metadata, prompts, edge
   conditions, and `LoopContinue` remain invalid carriers.
4. [`cycle-controller-result.schema.json`](../../spec/cycle-controller-result.schema.json)
   freezes the complete terminal envelope, status/exit mapping, counters,
   revision triple, terminal sequence, and non-self-referential history-prefix
   hash.
5. [`graph-revision.schema.json`](../../spec/graph-revision.schema.json)
   freezes revision 2+ separately from the revision-1
   `CompiledGraphIdentity`, including the exact closed lineage body and sibling
   revision hash.
6. [`cycle-controller.case.json`](../../spec/conformance/cycle-controller.case.json)
   provides 3 valid/6 invalid policy cases, 1 valid/8 invalid request cases,
   1 valid/4 invalid result cases, and 1 valid/4 invalid revision cases. It
   freezes objective, controller, request, and revision domain hashes and
   rejects unknown fields, omitted bounds, unsafe integers, mode/activity
   mismatches, false redaction claims, free-form carriers, authority objects,
   and next-revision overflow.

The frozen controller hash domain is
`graph-engineering/cycle-controller/v1alpha1\0`; the complete request hash uses
`graph-engineering/cycle-controller-request/v1alpha1\0`. Neither hash is
embedded in its own preimage.

## Former P0-02 — separate durable controller, event, checkpoint, and fold

Protocol closure evidence:

1. [`cycle-controller-event.schema.json`](../../spec/cycle-controller-event.schema.json)
   defines a closed `cycle-controller-recovery/v1alpha1` envelope and 16 closed
   discriminated payloads: controller creation; lease acquire/renew/release;
   round reservation; activity start/failure; atomic discovery; candidate
   evaluation; mode outcome; budget settlement/release; patch
   acceptance/rejection; round commit; and terminal result.
2. Every event binds controller/host/request identity, current graph revision,
   contiguous sequence, expected previous sequence/CAS, previous event hash,
   lease epoch/fencing identity, truthful payload disposition, payload hash,
   and domain-separated record hash. The first event is exactly sequence zero
   with version `-1`, null previous hash, and null lease.
3. `ActivityStarted` is the durable in-doubt boundary. Stable activity keys
   exclude attempt. Pure and correctly idempotent work may reuse the same key;
   an open non-idempotent activity remains `IN_DOUBT_SIDE_EFFECT` on resume and
   fork.
4. `DiscoveryCommitted` atomically binds exact canonical candidate bytes/hash,
   count, duplicate occurrences, and ordered seen additions. Evaluation,
   cancellation, failure, or patch rejection cannot erase rejected/unknown or
   unevaluated seen keys.
5. Budget reservation settlement and release are separate facts. Only
   settlement changes committed counters; a round cannot commit with a live
   remainder.
6. Both `PatchAccepted` and `PatchRejected` retain the exact canonical patch
   bytes, UTF-8 length, patch hash/ID, requested base, authenticated
   authority/policy hash snapshot, and reservation outcome. Acceptance alone
   stores a resulting revision body/hash. Exact decided-ID lookup precedes the
   stale-base check.
7. [`cycle-controller-checkpoint.schema.json`](../../spec/cycle-controller-checkpoint.schema.json)
   freezes the rebuildable checkpoint and complete fold projection: validated
   event prefix, current revision, lease, global seen/verdict categories,
   counters, live reservations, decided patches, committed rounds, at most one
   open round/activity, and terminal result. Events remain authoritative;
   stale/corrupt/ahead/inconsistent checkpoints cannot authorize work.
8. [`cycle-controller-durable.case.json`](../../spec/conformance/cycle-controller-durable.case.json)
   freezes a 16-event accepted-patch history, all four remaining phase-event
   shapes, every record hash, the terminal record hash, and a terminal
   checkpoint content hash. It adds 6 event-schema negatives, 10 hostile
   history mutations, 4 checkpoint-schema negatives, 4 semantic checkpoint
   mutations, 6 recovery boundaries, and 2 fork boundaries.
9. [`validate-fixtures.mjs`](../../scripts/validate-fixtures.mjs) now
   meta-validates and compiles all six new controller/revision schemas alongside
   GraphPatch, checks all positive/negative shapes, recomputes canonical
   objective/controller/request/patch/revision/event/checkpoint hashes, folds
   the valid history, and fail-closes hostile sequence, phase, hash, lease,
   authority, revision, reservation, category, checkpoint, recovery, and fork
   vectors.

The D7 machine surface is seven schemas in total: the existing candidate
`graph-patch.schema.json` plus six new controller/policy/result/revision/event/
checkpoint schemas. The D7 corpus comprises the existing bounded-cycle and
GraphPatch manifests plus two new carrier/durable manifests.

## Payload-protection boundary

The v1alpha1 durable controller stores authoritative objective, candidate,
seen-key, verdict, and patch bytes inline. It therefore requires
`payloadDisposition: inline-unredacted` and `redacted: false` in request,
event, checkpoint, and nested exact-payload carriers, plus an authenticated
inline-risk authorization hash. Hashing and canonical encoding are not called
redaction or protection.

This is intentionally not D9 evidence. `ProtectedValueRef`, ciphertext,
redacted tokens, or opaque lossy artifacts cannot replace authoritative bytes
under this version. A future protected mapping requires a new aligned contract,
native sink guard/store/key implementation, and migration/conformance fixtures.

## Verification evidence

Executed from `/home/nick/work/GraphEngineering`:

```text
corepack pnpm validate:fixtures
  51 JSON fixtures; 16 case manifests; 11 YAML fixtures
  9 GraphPatch schema cases
  6 new D7 schemas meta-valid
  16 chained event goldens + 4 standalone phase-event shapes
  green

corepack pnpm check:docs
  227 local Markdown links checked; green

corepack pnpm --filter @graph-engineering/patterns test
  93 passed; 0 failed

node --check scripts/validate-fixtures.mjs
  green

strict duplicate-key JSON parse
  8 new D7 schema/fixture documents parsed; no duplicate object keys
```

The new carrier/durable corpus contains 27 positive schema/golden documents or
events, 46 negative schema/semantic mutations, 6 recovery boundaries, and 2
fork boundaries. Existing bounded-cycle and GraphPatch semantic vectors remain
additional contract evidence.

## Remaining release blocker — P0-03

P0-03 is unchanged and release-blocking:

- no native TypeScript cycle controller or GraphPatch applier;
- no independent native Python cycle controller or GraphPatch applier;
- no scheduler/store/lease/budget/policy integration consuming these schemas;
- no native crash/resume/replay/fork execution at every event boundary; and
- no cross-language reporter comparing every result, counter, patch decision,
  mutation, and recovery observation without one language delegating to the
  other.

Therefore `D7-CYCLE-SPEC-024` must not be marked complete, and dynamic bounded
cycles/GraphPatch must remain unavailable in public capability claims until
P0-03 passes independent hostile review with immutable commit/test evidence.
