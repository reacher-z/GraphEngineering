# D7 bounded-cycle and GraphPatch independent hostile review

- Task: `D7-CYCLE-SPEC-024`
- Reviewed at: `2026-07-26T21:25:42Z`
- Base revision: `582b78ba9c0db9eab698b18c9cebf12bf547627a`
- Decision: **BLOCKED — protocol candidate strengthened; implementation and
  task completion not accepted**
- Commit: none; the reviewer did not commit or change registry/root config

## Scope and method

The reviewer read the complete 21-day master plan and audited its Graph IR,
execution primitive, durability, security, testing, and release promises against:

- `spec/runtime-semantics.md`;
- all of `spec/pipeline-semantics.md` and
  `spec/durable-recovery-semantics.md`;
- `spec/graph.schema.json` and `spec/compiled-identity.schema.json`;
- the TypeScript `packages/patterns` `loopUntilDry` implementation, README, and
  full tests; and
- the four D7 candidate artifacts: `cycle-semantics.md`,
  `graph-patch.schema.json`, `bounded-cycle.case.json`, and
  `graph-patch.case.json`.

The audit attacked global-seen crash windows, rejection rediscovery, batch and
graph amplification, budget reservation, simultaneous stop reasons,
cancellation at every phase, stale-base races, duplicate patch IDs, revision
lineage, authority inheritance, append-only topology, scheduler state races,
dry-run mutation, resume/replay/fork, and the boundary with the existing
revision-1 durable scheduler.

The static `packages/patterns` loop remains correctly labeled as an acyclic,
declarative-only expansion. Its green tests are not evidence for dynamic cycle
execution.

## Release-blocking open findings

### P0-01 — no machine-readable cycle carrier or controller/result schema

`graph.schema.json` has no cycle/controller node kind. The standalone prose
policy has no JSON Schema and there is no separately versioned public controller
API contract. Therefore neither native runtime can know where the controller is
declared, how its schemas/checkpoint scope bind, or how a graph invokes it.
Metadata labels, prompts, free-form `NodeSpec.config`, and the static
`LoopContinue` annotation cannot legally fill this gap.

The reviewed spec now makes this blocker explicit in section 3.1. Closure
requires one canonical controller-policy/result schema plus either an explicit
Graph IR carrier or a fully specified standalone API, shared by TypeScript and
Python fixtures.

### P0-02 — current durable recovery contract explicitly excludes this work

`scheduler-recovery/v1alpha1` binds `graphRevision: 1`, supports one immutable
DAG, and explicitly excludes patches, cycles, replay, and fork. Although the
generic event enum reserves `GraphPatched`, there are no exact durable payloads
or semantic folds for round reservations, discovery commits, seen additions,
evaluation/condition decisions, reservation settlement, accepted/rejected
patches, revision changes, or terminal cycle results.

The reviewed spec now forbids silently reusing that durable contract and lists
the required phase facts. This is still a blocker: a separately versioned event
and fold/checkpoint contract, exact schemas, crash windows, and native recovery
tests do not yet exist.

### P0-03 — no executable native cross-language join

The expanded manifests now contain hard-limit, recovery, cancellation,
idempotency, authority, depth/byte, revision-hash, and hostile-history vectors,
but the current fixture validator checks JSON/meta-schema and GraphPatch shape
only. No TypeScript/Python D7 engine or conformance reporter consumes the cycle
transition, recovery, or semantic patch cases. Consequently equality of exit
reasons, counters, patch decisions, resume/replay, and scheduler mutations is
not proven.

`D7-CYCLE-SPEC-024` must remain open/blocked; document presence and an Ajv pass
are not completion evidence.

## Closed protocol defects in this review

### P0-04 — revision 2+ contradicted the revision-1 identity contract — closed in prose/golden

The original draft required revision 2+ while referring to the existing
compiled-identity contract, whose schema and native verifiers require the
literal revision `1`. It also omitted an exact lineage preimage, making
cross-language `revisionHash` impossible to freeze.

The revised contract uses the revision-1 compiled identity only as the chain
seed and defines a separate `graph-engineering/revision-chain/v1alpha1\0`
domain plus a closed canonical body. A committed golden freezes the resulting
hash. The base schema now caps `graphRevision` at `2^53-2`, so increment cannot
overflow. A machine-readable revision-body schema remains part of P0-01/P0-02
closure.

### P0-05 — global seen additions could disappear after rejection/crash — closed in contract

The original draft inserted keys before evaluation but rebuilt only from fully
committed round records. A crash or patch failure after insertion could therefore
lose rejected/unknown keys and rediscover them forever.

The revised contract validates the entire bounded batch first, then atomically
commits the exact batch/hash and ordered seen additions before evaluation.
Resume never reruns that finder. Evaluation failure, patch rejection,
cancellation, and crash cannot remove the additions. Terminal results now carry
`unevaluatedCount`, so cancellation after discovery does not fabricate an
`unknown` verdict or lose a seen key.

### P1-01 — exact patch retry lost to stale-base ordering — closed in contract

The old transaction checked the current base before idempotency, so retrying an
already accepted patch necessarily failed stale after its own revision advanced.
The revised order validates/hashes, looks up the decided ID before base CAS, and
repeats lookup after a lost race. Exact accepted or rejected bytes return the
recorded decision; different bytes yield `GE_PATCH_IDEMPOTENCY_CONFLICT`.
Dry-run consumes no ID.

### P1-02 — partial reservation and CAS/authority gaps — closed in contract

The revised contract requires a worst-case closed round plan; durable
attempt/cost/structural reservations; explicit commit/release; deadline
enforcement; one authoritative event CAS; no second mutable revision record;
tenant-ledger compensation; authenticated proposer/grant/policy hashes; and
capability intersection that descendants cannot widen. Cancellation before CAS
prevents acceptance; cancellation after CAS cannot roll it back and prevents new
work release.

Native budget, policy, approval, and redaction enforcement is still future
implementation evidence. In particular, exact protected patch recovery bytes
must not bypass the still-open D9 redaction security join.

### P1-03 — resource amplification was possible — closed in contract/schema vectors

The original per-item byte/count limits allowed a huge aggregate batch, and the
patch schema had only per-document array counts with no canonical byte/depth or
cumulative resulting-graph ceiling. The revision adds independent item and batch
bytes, 100-level/100,000-value portable traversal, a 4 MiB patch ceiling,
bounded discoveries/dynamic nodes, complete resulting-graph node/edge/output
ceilings, required depth/fan-out limits, and one patch per controller round.
Oversized batches commit no partial seen set.

### P1-04 — state, map-order, and cancellation accounting were ambiguous — closed in contract

The revision now rejects every edge into a pre-existing node, allows existing
sources only after durable success, treats output maps as Unicode-ordered maps
rather than contradictory declaration-ordered objects, defines contiguous
reserved iteration accounting, preserves occurrence order for duplicate keys,
records cumulative counters, and freezes stop precedence including patch
rejection/failure/unknown. Ten cancellation boundaries include both sides of the
patch CAS.

### P2-01 — USD remains finite binary64 — bounded, later budget contract should revisit

For current determinism, the contract fixes finite-binary64 additions in durable
event order with exact inclusive comparisons and no epsilon. This can stop early
at familiar decimal rounding boundaries but cannot silently grant extra budget.
The later price/budget protocol should consider an integer monetary unit and
must freeze any migration rather than changing old histories.

## Independent verification evidence

Executed from `/home/nick/work/GraphEngineering`:

```text
corepack pnpm --filter @graph-engineering/patterns test
  93 passed

corepack pnpm validate:fixtures
  49 JSON fixtures; 14 case manifests; 11 YAML fixtures;
  3 compiled identities; 9 GraphPatch schema cases; green

corepack pnpm check:docs
  201 local Markdown links checked

custom canonical hash verifier using @graph-engineering/core
  2 GraphPatch hashes and 1 revision-chain hash verified

jq empty spec/graph-patch.schema.json \
  spec/conformance/bounded-cycle.case.json \
  spec/conformance/graph-patch.case.json
  green

trailing-whitespace and stale-phrase scans
  clean
```

One intermediate auxiliary `jq` run rejected a literal lone-surrogate negative
fixture. The case was corrected to carry escaped source JSON rather than making
the fixture document itself non-Unicode; the final `jq` and repository validator
runs above are green.

Reviewed artifact hashes:

```text
e9ff4e7f83531f90eaa068abb79dfe0ca28f0d0ba1addc0e12e78529032b1a46  spec/cycle-semantics.md
4955f03e8bb1a74721e5457073a48eab65562b179aee17ac799362072cb7cafb  spec/graph-patch.schema.json
913210f2b49acdeaeefe89b57881bf948f0ecd9485dbe358b1eb5b42826090ca  spec/conformance/bounded-cycle.case.json
fb908a407659f34d7625d7ffceeb2ddaa8d213e90ae7d52ab46b25bcf09fc35f  spec/conformance/graph-patch.case.json
```

These hashes precede this review-log file only; integration must recompute them
if any D7 artifact changes.

## Required closure sequence

1. Add a canonical cycle controller policy/result schema and explicit Graph IR
   or standalone API carrier; add it to offline schema validation and docs.
2. Freeze a new durable controller/event/checkpoint contract with exact phase
   payloads, graph revision fold, lease/CAS behavior, side-effect recovery, and
   accepted/rejected patch storage/redaction rules.
3. Implement independent native TypeScript and Python controllers and patch
   appliers; neither may shell out to or delegate semantics to the other.
4. Make the conformance runner execute every cycle, reservation, recovery,
   cancellation, hash, and semantic patch vector, including crash/resume/replay
   without finder/evaluator/clock/model re-execution.
5. Obtain a new hostile independent review with no open P0/P1, then bind exact
   immutable commit/test evidence in the registry.

Until all five are complete, do not mark `D7-CYCLE-SPEC-024`, native D7 cycles,
or dynamic GraphPatch execution complete or available.
