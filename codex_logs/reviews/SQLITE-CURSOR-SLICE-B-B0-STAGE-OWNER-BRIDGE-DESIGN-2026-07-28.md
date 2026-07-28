# SQLite Cursor Slice B B0 stage-owner bridge implementation brief

Date: 2026-07-28
Status: implementation-ready, read-only design
Scope: TypeScript and Python B0 only; no cursor query, cursor TEMP DDL,
diagnostic rule, rebind, permanent write or public API

## 1. Decision

B0 is a synchronous, one-shot ownership transfer from the historical
captured-source fence to the already-existing baseline TEMP stage. It must run
after the ordered handoff and all four predecessor campaigns complete, and it
must finish before the first cursor-specific TEMP statement is prepared or
executed.

The transfer is deliberately one-way:

1. A2b receipt provenance remains the authority for the exact source, clock,
   projection reference, projection identity and four ownership capabilities.
2. The current captured-source fence proves that this exact receipt graph came
   from the exact live EXCLUSIVE connection at the historical capture epoch.
3. The exact baseline stage proves that it owns the same projection, has
   completed legacy validation, has no active predecessor cursor, still owns
   its current epoch, and has an exact `allowedTotalChanges == total_changes`
   fence.
4. The stage atomically latches a private cursor-campaign session and freezes
   the transfer-time epoch and allowed-change count.
5. After the latch, the stage/campaign session is the live owner. Historical
   captured-source evidence is never rewritten. After B1's owned `CREATE TEMP
   TABLE`, the live stage epoch may advance only through the stage's closed DDL
   method; the old capture-epoch equality assertion is never called again.

This closes cross-runtime audit M2. It avoids both invalid alternatives:

- continuing to require `liveEpoch == captureEpoch` after legitimate cursor
  DDL, which would reject every correct B1 run; and
- mutating the source registry or source summary's captured epoch, which would
  turn historical evidence into a moving assertion.

## 2. Exact current lifecycle being bridged

The accepted lifecycle is already materially identical across TypeScript and
Python:

1. Configure and read back bounded FILE-backed TEMP storage outside a
   transaction.
2. Begin one owner-observed `EXCLUSIVE` transaction.
3. Construct the fixed baseline TEMP stage. Its tables, indexes and relation
   view are created before source capture.
4. Capture the exact v1 source summary on the same connection and current
   stage epoch.
5. Cooperatively stream each source entry into the common and normalized TEMP
   relations. Exactly two TEMP DML changes are adopted per entry.
6. Read the exact ordered projection and retain its exact identity object in
   the stage.
7. Complete stream/record invariants.
8. Complete checkpoint invariants.
9. Complete lease/lock/hold invariants.
10. Complete legacy-operation invariants.
11. Mint A2b from the exact source summary and exact projection identity.
12. Run B0.
13. Only then may B1 create the cursor-specific TEMP catalog.

### 2.1 TypeScript stage facts

`SQLiteBaselineTempStage` currently owns:

- exact `#connection` identity;
- `#state` (`open`, `poisoned`, `disposed`);
- mutable stage-owned `#transactionEpoch`;
- mutable stage-owned `#allowedTotalChanges`;
- exact ordered `#orderedProjectionIdentity`;
- exact expected per-kind counts;
- one-shot ordered handoff state;
- one-shot stream/record, checkpoint, lease/lock/hold and legacy campaign
  states and session identities; and
- at most one cleanup callback for each active predecessor campaign.

Successful legacy completion leaves `#legacyCampaignState === "complete"`,
clears the legacy session, proves exact common/relation counts, proves the
baseline TEMP catalog, proves the main operations catalog, and repeats the
allowed-change fence.

TypeScript does not directly retain the source-summary object in the stage.
The exact binding is nevertheless closed transitively: A2b retains the exact
source and exact projection identity, and the stage accepts only the exact
`#orderedProjectionIdentity` object generated from its completed ordered
handoff. B0 must compare those exact identities, not equal-value fields.

The private connection snapshot added by the preceding tranche is the only
acceptable capture-epoch observation for B0. Public subclass-overridable
getters cannot be promoted back into the source fence.

### 2.2 Python stage facts

`SQLiteV1BaselineTempStage` currently owns the same live invariants through:

- exact `_connection` identity;
- `_state`;
- `_transaction_epoch`;
- `_allowed_total_changes`;
- exact `_cooperative_summary` identity;
- exact `_ordered_projection_identity` identity;
- ordered-handoff completion;
- four predecessor campaign started/completed flags;
- exact active campaign sessions; and
- at most one active campaign cursor.

Successful `_complete_legacy_campaign` clears the legacy session and sets
`_legacy_campaign_completed = True` only after the main catalog, baseline TEMP
catalog, exact counts, relation coverage, epoch and allowed-change fences pass.

Python requires the exact connection-owner class in the source fence, so a
subclass cannot interpose on its connection observations. B0 must preserve
that exact-type rule for connection, stage, receipt witness and transfer
handle.

### 2.3 Epoch and change-counter facts

The fixed baseline TEMP catalog exists before capture. The later common and
relation inserts advance `total_changes`, but the accepted predecessor reads
do not advance the transaction epoch. Retained integration evidence proves:

```text
capture epoch == post-legacy epoch
capture total_changes < stage allowed total_changes == live total_changes
```

The source fence therefore correctly owns capture epoch but deliberately does
not own current `total_changes`. The stage correctly owns current
`total_changes`. B0 must evaluate both fences adjacently; neither is sufficient
alone.

## 3. Closed TypeScript API

No symbol, class or function below is exported from `packages/sqlite/src/index.ts`.
The recommended coordinator module is
`operation-baseline-cursor-stage-ownership.ts`; stage hooks remain in the
package-private cooperation contract so only the stage can mutate stage state.

The sole coordinator entry point is:

```ts
function beginSQLiteCursorStageOwnershipTransfer(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
): SQLiteCursorStageOwnershipTransfer
```

There is intentionally no parallel `summary`, `clockEvidence`,
`projectionIdentity`, ownership capability or epoch argument. All are derived
from the exact receipt's A2b provenance. B0 needs no options; cancellation and
diagnostic limits belong to later campaign work.

The returned `SQLiteCursorStageOwnershipTransfer` is an empty-own-key, frozen,
null-prototype opaque object registered by exact identity in a module-private
`WeakMap`. The registry value retains only identities needed by the next
owner:

```ts
interface TransferState {
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly preTransferWitness: SQLiteCursorPreRebindConnectionProvenance;
  readonly stageSession: object;
}
```

Capture epoch, stage epoch and allowed changes are not caller-readable fields.
The stage freezes them in its own private cursor-session state. The transfer
registry retains the exact pre-transfer witness so the fact that source
provenance passed cannot be substituted after DDL.

The package-private stage contract adds three B0 hooks:

```ts
const SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER = Symbol(...);
const SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER = Symbol(...);
const SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER = Symbol(...);

interface SQLiteBaselineCursorStageTransferOwner {
  [SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER] (
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    preTransferWitness: SQLiteCursorPreRebindConnectionProvenance,
  ): object;

  [SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER] (
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
  ): void;

  [SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER] (
    session: object | undefined,
    message: string,
  ): never;
}
```

The stage begin hook itself must call A2b provenance first, before reading any
stage or connection state. It must call
`assertSQLiteCursorPreRebindConnectionProvenanceWitness` both before stage
inspection and again as the final potentially failing operation immediately
before publishing its private session. This prevents a direct package-private
hook call from bypassing the coordinator and closes hostile getter/statement
interposition between the outer fence and the latch.

The coordinator's retained-handle fence is:

```ts
function assertSQLiteCursorStageOwnershipTransfer(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorStageOwnershipTransfer
```

It always runs A2b provenance first, then checks exact transfer identity,
exact receipt/connection/stage identity, and finally invokes the stage's exact
session fence. It does **not** rerun the historical live capture-epoch fence.
The exact pre-transfer witness is evidence retained by the immutable transfer,
not a live post-DDL authorization function.

## 4. Closed Python API

The recommended coordinator module is
`sqlite_operation_baseline_cursor_stage_ownership.py`. Nothing is re-exported
from the public package surface.

The sole entry point mirrors TypeScript:

```py
def _begin_sqlite_cursor_stage_ownership_transfer(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
) -> _SQLiteCursorStageOwnershipTransfer: ...
```

The transfer is an exact-type, slots-only, weak-referenceable, `eq=False`
opaque class. It contains no public value state. A `WeakKeyDictionary` maps the
exact object to immutable metadata containing exact connection, stage,
receipt, captured-source witness and stage-session identities. Construction
uses a module-private token, but token possession is never sufficient:
unregistered objects, `dataclasses.replace`, shallow copies, subclasses and
manually copied fields all fail exact identity registration.

The stage adds exact private methods:

```py
def _begin_cursor_stage_transfer(
    self,
    connection: SQLiteV1BaselineConnectionOwner,
    receipt: SQLiteCursorPreRebindReceipt,
    witness: _SQLiteCursorCapturedSourceConnectionWitness,
) -> object: ...

def _assert_cursor_stage_transfer(
    self,
    connection: SQLiteV1BaselineConnectionOwner,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
) -> None: ...

def _abort_cursor_stage_transfer(self, session: object | None) -> Never: ...
```

The begin method imports or invokes the exact source-fence registration check;
duck typing a `_assert_current` method is forbidden. A2b is checked before
connection or stage state. The exact captured witness is checked again as the
last fallible operation before private stage-session publication.

The retained transfer assertion mirrors TypeScript and does not call
`witness._assert_current()` after owned cursor DDL. It reruns A2b, validates
exact registered transfer identity, and invokes the stage's live session
fence.

## 5. Atomic B0 order

The following order is normative in both languages.

### Phase A: database-independent authority

1. Call the existing non-consuming A2b receipt provenance assertion.
2. Derive the exact source summary, clock evidence, projection identity,
   projection reference, tenant ownership, source-stage ownership, campaign
   ownership and connection ownership from that assertion.
3. Do not accept caller copies of any derived value.

### Phase B: historical source/connection proof

4. Mint the existing exact captured-source connection witness. This repeats
   A2b first and proves exact source registry identity, exact connection,
   active EXCLUSIVE mode and exact historical capture epoch.
5. Allocate the prospective opaque transfer object and prospective stage
   session before the final fence. Allocation failure must leave the stage
   untouched.

### Phase C: exact stage proof

6. Enter the exact stage begin hook. It repeats A2b first and validates the
   registered pre-transfer witness before touching stage state.
7. Require exact stage connection identity and `open` state.
8. Require no previous cursor transfer state. `unused` is the only accepted
   state.
9. Require ordered handoff complete and no ordered reader/cleanup active.
10. Require stream/record, checkpoint, lease/lock/hold and legacy campaigns all
    complete, with every predecessor session and cursor/cleanup slot empty.
11. Require exact receipt-derived projection identity to be the stage's exact
    retained projection identity. Python additionally requires exact
    receipt-derived summary to be `_cooperative_summary`; TypeScript relies on
    the exact projection/source relationship already proven by A2b.
12. Require projection entry count equal to the completed staged sequence and
    expected common/relation counts.
13. Require exact baseline TEMP catalog and main legacy operations catalog.
    This also proves no cursor-specific reserved object already exists.
14. Require the stage's current epoch equal to the live connection epoch.
15. Require the stage's current allowed total changes equal to live
    `total_changes`, read twice around the terminal catalog/identity checks.
16. Repeat the exact captured-source connection-witness assertion. This is the
    last fallible observation before the latch.

### Phase D: one-way publication

17. Freeze private stage transfer state containing exact receipt, exact source
    graph (directly or through exact receipt), exact projection identity,
    exact stage session, historical capture epoch at transfer, current stage
    epoch and current allowed-change count.
18. Set the stage cursor-transfer state from `unused` to `active` exactly once.
19. Register the prospective opaque transfer object against exact
    connection/stage/receipt/witness/session identities.
20. Return it.

There is no `await`, callback, user hook, SQL statement, caller-visible object
mutation or TEMP DDL between steps 16 and 20. In Python the GIL is not the
security argument; the absence of arbitrary calls is. In TypeScript the
synchronous call stack is not enough by itself; the private snapshot and
stage fences remove subclass getter interposition.

## 6. Ownership capability semantics at transfer

A2b already proves that the exact four capability objects belong to the exact
capture session. Before B0, those capabilities are database independent. B0
gives them their database meaning by adjoining them to the exact proven stage:

- `tenantOwnership` means the complete tenant namespace on this captured
  connection, not one tenant string;
- `sourceStageOwnership` is adopted as ownership of this exact completed
  baseline stage and projection;
- `campaignOwnership` is adopted as ownership of this exact one-shot cursor
  campaign session; and
- `connectionOwnership` is adopted only after the captured-source fence proves
  the exact live connection.

No capability commitment or reference bytes are exposed or recomputed by the
stage. The exact receipt remains the sole authority. A different receipt with
equal scalar payload cannot join the transfer because receipt and transfer
identity are exact and registry backed.

## 7. Stage state to add

TypeScript adds private state equivalent to:

```ts
#cursorTransferState: "unused" | "active" | "complete" | "poisoned" = "unused";
#cursorTransferSession?: object;
#cursorTransferReceipt?: SQLiteCursorPreRebindReceipt;
#cursorTransferProjection?: OperationBaselineProjectionIdentity;
#cursorTransferCaptureEpoch?: bigint;       // immutable after latch
#cursorTransferStageEpoch?: bigint;         // live stage owner, B1 may adopt exact DDL
#cursorTransferAllowedTotalChanges?: number; // live stage owner
```

Python adds the same logical fields. Historical capture epoch and live stage
epoch are separate even though they are equal at B0. The capture field is
never assigned again. The live stage epoch changes only inside a closed owned
DDL method after exact before/after validation.

The stage's existing canonical `#transactionEpoch`/`_transaction_epoch` and
`#allowedTotalChanges`/`_allowed_total_changes` remain the actual live fences.
The cursor session stores transfer snapshots for binding and diagnostics; it
must not introduce a second caller-settable allowance.

## 8. B1 seam fixed by B0

B0 executes no cursor SQL. It must nevertheless freeze the only legal B1
transition so implementation cannot accidentally reintroduce M2.

The future cursor TEMP create operation is a closed stage method taking only
the exact active stage session. It performs:

1. retained-transfer A2b and exact session fence;
2. baseline-only catalog proof and absence of `ge_blr_cursor_seal`;
3. `epochBefore == stage live epoch == transfer stage epoch`;
4. `changesBefore == stage allowed changes == live total_changes`;
5. execute exactly one constant `CREATE TEMP TABLE ge_blr_cursor_seal ...`
   statement through the owned connection;
6. require `epochAfter == epochBefore + 1` in both current owner wrappers;
7. require `total_changesAfter == changesBefore`;
8. validate the phase-aware catalog as baseline objects plus exactly the one
   cursor table with its exact STRICT/WITHOUT ROWID shape;
9. repeat epoch and total-change observations; and
10. only then adopt `epochAfter` into the live stage epoch.

There is no general `adoptEpoch`, `setAllowedChanges`, raw SQL or DDL callback.
Failure poisons the cursor session and stage. Best-effort cleanup removes only
the cursor object created by this attempt and preserves the primary error.
Cleanup/drop epoch movement belongs to the stage disposal path, never to the
historical source evidence.

After step 10, all live fences use the retained transfer plus stage session.
Calling the old captured-source live-epoch fence is a programmer error and a
test failure; it is expected to reject because the live epoch legitimately
advanced.

## 9. Failure precedence and state transitions

### Before exact source/connection acceptance

- forged or stale A2b receipt: A2b error is authoritative; do not touch the
  connection or stage;
- source clone or synthetic A2b receipt: captured-source provenance error; do
  not touch the stage;
- wrong/closed connection or rollback/rebegin: source/connection fence error;
  do not start cursor transfer;
- allocation failure: propagate; stage remains `unused`.

### After exact source/connection acceptance

- wrong stage, incomplete predecessor lifecycle, projection mismatch,
  unexplained DML, catalog drift, active cleanup/cursor or second begin is
  terminal for that stage and poisons it;
- the cursor-transfer latch is burned on every attempted stage begin after
  source/connection authority is accepted; a caller cannot fix one argument
  and retry against a partially inspected stage;
- a second begin against an active transfer poisons the active cursor session
  and stage rather than returning a second handle;
- abort clears the active cursor/session ownership exactly once, closes any
  later B1 active cursor through the shared stage cleanup path, marks transfer
  `poisoned`, and throws the authoritative error;
- stage disposal with an active B0-only session owns no extra SQL object but
  clears its in-memory session. Once B1 exists, disposal also owns cursor TEMP
  cleanup before baseline catalog cleanup;
- transaction loss or connection close clears only in-memory ownership when
  SQL cleanup is no longer safe; SQLite connection teardown owns TEMP removal.

An invalid A2b receipt must remain first even when the presented stage is
disposed or the connection is closed. Tests must distinguish this ordering by
error code/message and by proving no stage-state transition occurred.

## 10. Required TypeScript tests

Add a focused source-level suite for the new coordinator plus stage lifecycle
extensions. All tests use deterministic SQLite fixtures; no model provider is
involved.

### Happy path and nonclaim

1. Run the full real predecessor lifecycle through clean legacy completion,
   mint the exact receipt, and begin B0 successfully.
2. Prove the transfer handle is frozen, null-prototype, empty-own-key and
   accepted only by exact identity.
3. Prove B0 creates no TEMP object, changes no main row, changes no
   `total_changes`, and does not advance transaction epoch.
4. Prove capture epoch, transfer stage epoch and live stage epoch are equal at
   B0 while capture-time total changes are lower than the current stage-owned
   allowance.
5. Revalidate the transfer repeatedly before B1.
6. Prove package-root exports contain none of the real B0 runtime functions or
   symbols. Do not test erased interface names with `Object.keys`.

### Authority and identity negatives

7. Forged receipt with a closed connection fails A2b first and does not touch
   stage state.
8. Structurally equal source clone retained by a pure A2b receipt is rejected
   before stage begin.
9. Genuine receipt on another connection is rejected.
10. Genuine receipt with another stage is rejected and cannot publish a
    transfer.
11. Equal-value projection clone or reference clone cannot bind the exact
    stage projection.
12. Another exact receipt from a distinct A2b issuer cannot revalidate the
    original transfer even if its payload hashes match.
13. Frozen spread/copy/prototype-forged transfer handles are rejected.
14. A handle from another clean run is rejected by exact connection, stage,
    receipt and session identity.

### Stage phase negatives

15. Begin before ordered handoff completion is terminal and creates no cursor
    TEMP object.
16. Begin after ordered handoff but before stream/record completion fails.
17. Begin before checkpoint completion fails.
18. Begin before lease/lock/hold completion fails.
19. Begin while legacy is active fails and finalizes/poisons according to the
    existing single-cursor owner rules.
20. Begin after legacy completion with a retained cleanup/cursor injection
    fails.
21. Second begin with the same receipt fails terminally.
22. Second begin with a different otherwise valid receipt also fails.
23. A direct call to the package-private stage hook with a forged
    pre-transfer witness fails its exact registry check.

### Epoch, counter and race negatives

24. Rollback/rebegin rejects before publication.
25. A real epoch-mutating PRAGMA between capture and B0 rejects.
26. An unexplained main DML rejects through the stage change fence even though
    the source-only fence still accepts.
27. An unexplained TEMP no-op DML rejects through the stage change fence.
28. A hostile `SQLiteConnection` subclass that advances the real private epoch
    from public getters cannot publish B0.
29. Injection during the first source fence is caught by its second private
    snapshot.
30. Injection during stage catalog/counter inspection is caught by the final
    retained-witness and stage fences.
31. Injection immediately before transfer registration leaves no observable
    handle and poisons/burns the reserved stage session.

### B1 seam regression

32. A test-only exact owned `CREATE TEMP TABLE` transition demonstrates that
    the historical captured-source live fence rejects afterward while the
    retained stage-transfer fence accepts the exact adopted `+1` epoch.
33. `+0`, `+2`, transaction replacement, row-change movement, catalog shape
    mismatch and caller-executed DDL are rejected and never adopted.
34. Verify the capture epoch stored by the source registry and transfer
    snapshot never changes across the owned transition.

## 11. Required Python tests

Mirror every semantic TypeScript case, with Python-specific hostile vectors:

1. exact-type connection, stage, receipt witness and transfer success after
   `_legacy_campaign_completed`;
2. exact source summary and projection identity retained by the stage;
3. B0 no-SQL/no-epoch/no-change/no-catalog-mutation proof;
4. repeated exact transfer revalidation;
5. forged receipt/closed connection A2b-first ordering;
6. wrong connection and wrong stage;
7. rollback/rebegin and PRAGMA epoch mutation;
8. unexplained main and TEMP DML caught only by the stage fence;
9. pre-handoff and each incomplete predecessor campaign state;
10. active predecessor cursor/session injection;
11. second begin with same and different receipts;
12. direct private stage method call with fake duck-typed witness;
13. `dataclasses.replace` if a dataclass is used internally;
14. `copy.copy`, `copy.deepcopy`, pickle round trip, copied construction token,
    manual slot population and subclass attempts;
15. weak-registry collection and stale callback/id-reuse safety;
16. transfer from another fixture with equal scalar contents;
17. closed connection property access normalized without masking A2b or the
    primary stage error;
18. exact owned `CREATE` transition proving stage transfer remains live while
    historical witness current-check rejects; and
19. capture epoch immutability after adoption and cleanup.

Cross-runtime conformance should freeze common scenario names and outcomes,
not implementation-specific error strings. The required semantic outcomes are
`accepted`, `invalid-authority`, `stale-epoch`, `unexplained-write`,
`incomplete-stage`, `already-started`, `poisoned` and `disposed`.

## 12. Verification gates for implementation

Each language lane runs focused tests first, then independent cross-review.
The integration owner runs:

- full `@graph-engineering/sqlite` source suite;
- SQLite typecheck, lint and build;
- full Python suite;
- scoped Ruff lint and format check;
- strict MyPy;
- cross-runtime B0 conformance fixtures;
- `git diff --check` on every changed file;
- package-root non-export checks for real runtime names; and
- an independent hostile probe covering clone, wrong-owner, rollback/rebegin,
  unexplained DML and exact owned DDL epoch adoption.

No B0 implementation is accepted if its test only constructs a synthetic
stage. At least one retained test per language must execute the complete real
stage/handoff/four-campaign predecessor chain.

## 13. Parallel implementation lanes

The work can proceed in three non-overlapping lanes after this brief is
accepted:

1. TypeScript lane owns `packages/sqlite/`: closed cooperation symbols, stage
   cursor-transfer state, coordinator, focused tests and internal docs.
2. Python lane owns `python/`: exact registered transfer type, stage methods,
   coordinator and mirrored tests.
3. Independent audit lane remains read-only until both implementations land,
   then attacks authority ordering, clone identity, epoch transfer and
   `total_changes` separation.

The integration owner alone changes shared spec or plans if a later public
contract requires it. B0 is package private and does not itself justify a
public protocol change.

## 14. Completion definition

B0 is complete only when both runtimes prove all of the following:

- receipt is the sole explicit source/projection/ownership authority;
- A2b always fails first before database observation;
- exact captured source and exact connection are live at the historical epoch;
- exact stage and exact projection completed every predecessor campaign;
- live stage epoch and allowed-change counter are fenced adjacently;
- no cursor TEMP object exists before the transfer;
- exactly one opaque stage/campaign session is published;
- clone, replacement, second-run and wrong-owner paths cannot join it;
- the transfer remains the live authority after one exact stage-owned cursor
  DDL epoch transition;
- historical capture evidence is unchanged and no longer misused as a live
  post-DDL epoch assertion; and
- all focused, full, static and cross-runtime gates pass.

Anything less is still a pre-transfer source witness, not a B0 stage-owner
bridge.
