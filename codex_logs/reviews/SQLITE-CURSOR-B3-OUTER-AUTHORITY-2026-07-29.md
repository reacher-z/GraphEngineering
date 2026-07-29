# SQLite cursor B3 outer-publication authority closure — 2026-07-29

## Outcome

The package-private TypeScript B3 outer-publication authority seam is complete
for its deliberately narrow scope. It adopts one exact completed B2 graph,
consumes the first provider-clock evidence once, retains the exact tombstone,
and transfers the TEMP-stage owner into an active outer authority without SQL,
permanent writes, migration `0002`, cursor rebind, transaction control, TEMP
retirement, rules 11/12, or commit.

This is not the cursor publication operation and is not a release-completion
claim. The next implementation leaf remains the portable initial-write digest
codec and its golden/rejection vectors, followed by the separately reviewed
post-DDL fence/reader and four-write ledger tranches.

## Exact implementation surface

- `packages/sqlite/src/cursor-publication-clock-authority.ts`
- `packages/sqlite/src/cursor-publication-outer-authority.ts`
- `packages/sqlite/src/operation-baseline-cooperation.ts`
- `packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts`
- `packages/sqlite/src/operation-baseline-stage.ts`
- `packages/sqlite/test/cursor-publication-outer-authority.test.ts`

No package-root export was added. The authority, cancellation signal, tail
continuation, stage bridge, clock graph assertions, snapshots and target
descriptor remain package-private.

## Closed invariants

1. Preparation accepts only the exact receipt, projection, transfer, stage,
   connection, migration-lock capability, provider-clock capability and first
   boundary evidence from one live EXCLUSIVE transaction lineage.
2. The activation tail receives a private, opaque, single-use continuation.
   Arbitrary transfer/authority pairs cannot invoke publication.
3. Cancellation is checked before the tail and is the only retryable inactive
   outcome. It consumes neither evidence nor the tail.
4. Non-cancellation invariant failures are terminal: transaction-generation
   replacement retires the authority; graph, clock or ledger drift poisons it.
5. Evidence consumption constructs and registers the immutable tombstone before
   setting the one-way `consumed` bit, preventing consumed-without-tombstone
   partial state.
6. Retirement burns an armed tail before changing stage lifecycle. A captured
   retired tail cannot revive either the stage or transfer.
7. Successful tail publication is single-use. Replay fails before assignment
   and does not damage the already-owned graph.
8. Active revalidation uses stable in-memory object identity plus the outer
   authority's mutable current epoch/`total_changes` watermark. It does not
   replay the obsolete pre-`0002` B2 fence.
9. Rollback/rebegin converts inactive and active authorities to `retired`; a
   later clock boundary converts an inactive authority to `poisoned`.
10. The normal prepare/activate/assert path executes zero SQL and leaves owner
    epoch, `total_changes`, transaction lineage and TEMP inventory unchanged.

## Adversarial evidence

The focused authority suite contains 14 cases covering the clean exact graph,
cancellation/retry, structural clones, cross-run substitution, unfinished and
diagnosed B2 graphs, preconsumed evidence, every graph identity substitution,
later-boundary poison, inactive and active rollback retirement, hostile ambient
`Object.create`/`Object.freeze`, retired armed-tail burn, successful tail replay,
zero-write/no-overreach behavior, and runtime plus TypeScript root-export
isolation.

The hostile intrinsic case replaces ambient `Object.create` and `Object.freeze`
after module import. Activation still succeeds because the evidence tail uses
captured intrinsics. Both retired-tail and successful-tail replay cases require
structured `GE_CYCLE_STORE_INVALID_ARGUMENT` failure before any assignment.

## Verification on the final byte set

- Outer-authority focused tests: 14/14 passed.
- Clock-authority focused tests: 8/8 passed.
- SQLite package full suite: 24 files, 859/859 tests passed.
- SQLite package typecheck/lint: passed.
- Workspace typecheck: all eight implementation packages passed.
- Workspace lint: all eight implementation packages passed.
- `git diff --check`: passed.
- Independent final scope audit: HIGH 0 / MEDIUM 0 / LOW 0.

## Review corrections made before acceptance

The first audit rejected the tranche because rollback did not create a terminal
authority state, active assertion replayed the old B2 epoch fence, pre-tail
failures could leave a retryable ghost, publication accepted an arbitrary
authority pair, and evidence consumption could theoretically expose a partial
tail. Those defects were fixed and retested.

The second audit found that retirement did not delete an already armed opaque
tail. Retirement now deletes that continuation using captured WeakMap
intrinsics, and publication rejects a missing continuation before assignment.
Two direct bridge-level tests prove that a retired tail cannot revive ownership
and a successfully consumed tail cannot be replayed.

## Nonclaims and next boundary

This milestone does not implement the portable initial-write parameter/result
digest codec, execute `0002-v1-to-v2-operation-replay.sql`, perform the fixed
four permanent writes, issue the write receipt, prove the post-DDL reader
terminal, rebind cursors, verify rules 11/12, retire TEMP state, commit, reopen,
or publish an active manifest. It therefore does not by itself make the SQLite
v1-to-v2 protocol complete or make the repository a formal release candidate.

The immediate next production leaf is the package-private TypeScript portable
initial-write digest codec with all seven frozen golden vectors and hostile
rejection vectors. That leaf must remain pure and must not execute SQL.
