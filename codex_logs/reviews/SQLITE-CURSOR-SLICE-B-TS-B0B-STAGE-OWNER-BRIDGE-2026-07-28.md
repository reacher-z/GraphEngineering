# SQLite Cursor Slice B0b TypeScript stage-owner bridge implementation review

Date: 2026-07-28
Scope: TypeScript B0b only
Disposition: ready for independent cross-audit

## Result

TypeScript B0b is implemented with local severity **HIGH 0 / MEDIUM 0 / LOW
0** inside the declared tranche.

The implementation adds one synchronous, package-private factory:

```ts
beginSQLiteCursorStageOwnershipTransfer(connection, stage, receipt, options?)
```

It accepts no caller-supplied summary, clock, projection, capability, epoch or
change counter. Receipt provenance is always evaluated first. Source,
projection and ownership context are derived only from the retained A2b receipt.

B0b executes no cursor query, creates no cursor TEMP object, performs no
cursor rebind and changes no permanent state. Its only effect is a one-shot
private ownership latch on the exact completed baseline stage.

## Implemented ownership chain

The successful path is now:

1. non-consuming A2b receipt provenance;
2. pure validation of the currently empty options carrier;
3. B0a exact source/connection/private-epoch witness mint;
4. exact active stage identity through the connection-owned `ACTIVE_STAGES`
   registry;
5. direct stage-hook A2b and B0a-witness revalidation before stage inspection;
6. exact connection and `open` stage state;
7. completed ordered handoff with no session/cleanup residue;
8. completed stream/record, checkpoint, lease/lock/hold and legacy campaigns,
   with no active session/cleanup residue;
9. exact receipt-derived projection object equal to the stage-owned ordered
   projection;
10. exact source/projection entry count equal to the completed cooperative
    sequence;
11. exact baseline TEMP catalog, main legacy-operation catalog, common counts
    and relation-key coverage;
12. stage-owned epoch and `allowedTotalChanges` fences;
13. base-class-private owner and `total_changes()` snapshots that cannot be
    interposed by subclass getters or `prepare` overrides;
14. final B0a revalidation and one-way consumption as the last fallible
    operation; and
15. atomic publication of one exact stage session and one frozen opaque
    transfer handle.

The transfer handle is a frozen, null-prototype, empty-own-key object backed by
a private `WeakMap`. Its retained state binds exact connection, stage, receipt,
consumed B0a witness and stage session identities.

## One-way epoch ownership

The stage records separate private values for:

- immutable capture epoch at transfer;
- current stage/campaign epoch;
- current stage/campaign allowed change count;
- exact receipt;
- exact projection; and
- exact session.

The captured-source registry and source summary are never modified. Successful
B0b burns the exact B0a witness; its old live capture-epoch assertion cannot be
reused as post-transfer authority.

Retained B0b revalidation reruns A2b, checks the exact transfer registry and
then fences the live stage/session. It deliberately does not replay B0a's
historical epoch equality. This is the closed seam required for B1 to adopt
only its exact stage-owned cursor DDL transition.

No general epoch or allowed-change setter was added.

## Private connection counter fence

The existing stage counter helper calls the public `prepare` surface. A hostile
`SQLiteConnection` subclass can override that method. B0b therefore adds a
separate package-private connection intrinsic for `total_changes()`:

- it uses the base class's `#database` directly;
- it performs two hardened array/BigInt reads;
- it brackets them with class-private transaction epoch and transaction-state
  observations;
- it rejects counter, epoch or transaction instability; and
- its wrapper invokes the captured base intrinsic with `Reflect.apply`.

Both B0b begin and retained transfer fences pair this counter intrinsic with
the earlier private owner snapshot. A test overrides public `prepare`, injects
TEMP DML and returns a forged historical change count to every public stage
read. The private intrinsic observes the real count and rejects publication.

## B0a consumption

`SQLiteCursorPreRebindConnectionProvenance` registry state now includes a
private consumed bit. Normal B0a use remains repeatably revalidatable before
B0b. The B0b stage hook calls a new package-private consume operation only at
the final boundary. It:

1. performs A2b first;
2. requires exact unconsumed witness and receipt identity;
3. reruns the live captured-source/private-owner fence; and
4. atomically replaces registry state with `consumed: true`.

Every later B0a revalidation or second consumption of that exact witness fails.
A focused direct-stage test retains this behavior as a regression.

## Fail-closed behavior

- forged receipt wins before options, connection or stage observation;
- invalid non-empty options fail after A2b but before B0a or stage mutation;
- source clone/synthetic/wrong-connection behavior remains owned by B0a;
- wrong stage and prototype-derived stage clone fail exact `ACTIVE_STAGES`
  identity without touching either real stage;
- incomplete predecessor phases, projection substitution, stale counter and
  second begin poison the exact stage after source authority is accepted;
- rollback/rebegin and stale capture epoch fail B0a before stage begin;
- a hostile getter that advances the real epoch during stage inspection is
  caught by final B0a consumption and poisons the stage;
- hostile public `prepare` counter forgery is caught by the private connection
  counter snapshot;
- counter drift after a successful transfer is caught by the retained live
  stage-owner fence; and
- no failure path creates a cursor TEMP object because B0b contains no cursor
  DDL or cursor SQL.

## Files

Source:

- `packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts` — new
  opaque coordinator and retained transfer assertion;
- `packages/sqlite/src/operation-baseline-cooperation.ts` — closed begin/fence/
  abort symbols and stage interface;
- `packages/sqlite/src/operation-baseline-cursor-ownership.ts` — one-shot B0a
  witness consumption;
- `packages/sqlite/src/operation-baseline-stage.ts` — exact stage identity,
  completed predecessor proof, private transfer state and live fence;
- `packages/sqlite/src/sqlite-connection.ts` — base-intrinsic private change
  counter snapshot.

Tests:

- `packages/sqlite/test/operation-baseline-cursor-stage-ownership.test.ts` —
  20 B0b lifecycle and hostile cases.

No package-root export, plan, daily log, registry, Python, D6 or spec file was
changed by this implementation lane.

## Test coverage

The 20 focused B0b tests retain:

1. complete real predecessor lifecycle success;
2. opaque handle shape and repeated exact revalidation;
3. zero cursor TEMP/SQL/epoch/counter/catalog mutation at begin;
4. package-root runtime non-export;
5. transfer clone and distinct receipt rejection;
6. exact B0a consumption;
7. forged receipt A2b-first ordering on a closed connection;
8. invalid options ordering;
9. wrong connection without stage mutation;
10. different exact stage rejection;
11. prototype-derived stage clone rejection;
12. exact projection identity rejection;
13. pre-cooperative/pre-ordered rejection;
14. ordered-only incomplete predecessor rejection;
15. stream-only incomplete predecessor rejection;
16. checkpoint-only incomplete predecessor rejection;
17. lease-only/incomplete-legacy rejection;
18. unexplained pre-transfer and post-transfer TEMP DML rejection;
19. rollback/rebegin and second-begin rejection; and
20. hostile public counter forgery and hostile getter epoch TOCTOU rejection.

The adjacent B0a suite remains green and continues to cover source clones,
synthetic summaries, wrong connections, stale witnesses, A2b-first ordering,
hostile subclass epoch access and the complete real predecessor lifecycle with
advanced stage-owned total changes.

## Verification

Final commands and results:

```text
corepack pnpm --filter @graph-engineering/sqlite test
  20 files passed
  453 tests passed

corepack pnpm --filter @graph-engineering/sqlite typecheck
  passed

corepack pnpm --filter @graph-engineering/sqlite lint
  passed

corepack pnpm --filter @graph-engineering/sqlite build
  passed

git diff --check -- packages/sqlite/src packages/sqlite/test
  passed
```

The focused B0b file passes 20/20 and the combined B0a+B0b selection passes
27/27.

## Nonclaims and next audit

This result claims only B0b ownership transfer. It does not claim B1 cursor
TEMP catalog creation, cursor scan/seal, B2 diagnostics, A1 reproduction,
rebind, publication or migration completion.

Independent cross-audit should now attack:

- A2b/source/stage failure precedence;
- direct package-private stage-hook misuse;
- B0a witness consumption and second-witness behavior;
- stage clone/prototype/other-run identities;
- subclass getter and public `prepare` interposition;
- counter and epoch drift immediately before latch publication;
- transfer-handle clone and receipt substitution; and
- whether the future B1 seam can adopt only one exact owned `+1` cursor DDL
  epoch without mutating capture evidence.
