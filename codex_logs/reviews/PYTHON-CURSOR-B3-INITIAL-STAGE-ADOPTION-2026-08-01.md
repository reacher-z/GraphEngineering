# SQLite Cursor B3 — Python initial-stage adoption

Date: 2026-08-01

Branch: `feat/authoring-foundation`

Plan authority: master plan §§31.37.36, 31.37.37 and 31.37.50.6–31.37.50.10

Status: **accepted for scoped commit.** The final whole-Python-suite regression
completed with exit code zero.

## Outcome

This leaf implements the Python side of initial-stage adoption for the exact
four-receipt initial-publication chain:

1. migration 0002 execution;
2. baseline entries publication;
3. baseline header publication;
4. operation-sequence-zero publication.

The adoption consumes those four exact receipts, mints four typed consumed
tombstones and one adoption receipt, and exposes the result only after the
outer, ownership and stage layers have all completed one sealed atomic tail.
The observable success transition is therefore exactly `4/4/1`; every tested
post-prepare construction or registration failure leaves the public transition
at `0/0/0`, poisons every privately created pending proof, poisons all three
authority layers and burns both continuations.

This leaf does not publish a cursor session, execute cursor rebind, implement
rules 11 or 12, acquire a second provider-clock boundary, publish lineage or
metadata rows, perform the final semantic audit, retire the TEMP catalog,
commit or roll back the transaction, or activate a v2 manifest. It does not
claim full 145-case cross-runtime execution parity, release readiness, external
adoption or any GitHub-star outcome.

## Production change

Three package-private modules form the implementation boundary.

| File | Final lines | SHA-256 |
|---|---:|---|
| `python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py` | 5,820 | `4ae74f4097360db680c18ffddab7ac860b8e4fb9b6275892409b536338b573ec` |
| `python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py` | 1,546 | `6f7d1de70d1f52de7df945f2ae2e51237407063e74755b9b6276b5dc015877f0` |
| `python/src/graph_engineering/sqlite_operation_baseline_stage.py` | 4,819 | `256a0d263b9dd50498f09b63bf6c81f4d5065a99eea78bc6d26a68d4e6be2fa8` |

The production subject totals 12,185 lines. The apparent size is intentional:
the implementation captures exact built-ins and lower-layer intrinsics at
definition time, keeps all capabilities package-private, and rejects hostile
module/class alias replacement without dispatching caller protocols inside the
atomic tail.

### Entry and error classification

The entry accepts only a built-in four-element tuple in the frozen order. It
does not iterate a caller object or use caller-defined `len`, indexing,
equality, hashing or attribute access.

Presentation errors are retryable and non-mutating. This includes malformed
carriers, cloned receipts, a complete foreign graph, wrong authority,
connection or projection identity, wrong ordering and a foreign typed
tombstone. These cases preserve all three live layers and leave receipt
consumption, tombstone mint and adoption mint counts at `0/0/0`.

Once the exact authentic graph has been identified, graph drift is terminal.
Transaction-lineage replacement, epoch drift, real `total_changes` drift,
catalog drift, terminal-reader drift, ledger drift, exact replay, old receipt
reuse and receipt substitution poison the outer authority, ownership bridge and
stage. No terminal graph can be retried or converted to `retired` or `adopted`.

### Complete validation before preparation

Every attempt re-proves:

- exact connection, stage, transfer, projection and authority identities;
- transaction generation, epoch and live SQLite `total_changes`;
- the complete fresh 34-object v2 target catalog;
- the terminal post-DDL reader contract and its re-derived projection;
- all four receipt identities, parameter/result commitments and ordered
  predecessor chain;
- the complete outer ledger and all permanent-write counters;
- the exact B2 catalog/change fence that this leaf alone is authorized to
  retire.

Cancelled prepared retries run these proofs again. A cancelled attempt cannot
use a cached catalog, reader result, transaction snapshot, ledger or receipt
assertion.

### Cancellation boundary

There is one cancellation observation. It occurs after complete validation and
after both lower continuations, including their private weak registrations,
are prepared. It remains before allocation or registration of any adoption
output: the four tombstones, adoption receipt, their weak graph edges and their
output records do not yet exist. A cancelled call therefore returns no partial
adoption result and can retry the same exact bundle with the same prepared
continuations.

### Sealed atomic tail

The tail burns the paired outer and stage continuations before mutation. The
recursive wrapper → `perform_tail` → ownership → stage closure has no SQL,
provider callback, cancellation read, test hook, transaction operation,
connection/cursor rebind, import or caller-code dispatch.

It allocates four typed tombstones and one adoption receipt, builds private
pending records and registers every weak graph edge. It then publishes the
lower stage transition. Only after lower publication succeeds does it attach
the four tombstones and adoption receipt to outer state, set the public
`4/4/1` counts, advance the outer phase and activate all five proof records.
Pending records are never readable. Fault injection covers allocation, record
construction, weak-reference construction and every registration boundary.

The terminal wrapper covers failures occurring after cancellation but before
or during no-fail publication. It poisons every pending record, resets public
counts to zero, burns both tails and propagates poison through all three layers.
An independently constructed real full-outer probe corrupts only the stage's
final publish gate after both authentic preparations; the outer, ownership and
stage lifecycles all become poisoned and both tail replays are rejected.

### Successful adoption boundary

Success adopts the current transaction epoch, real `total_changes`, complete
v2 catalog and exact outer ledger. It retires only the obsolete B2 v1
catalog/change fence and its old capture fields. It retains the B2 receipt,
projection identity/reference, ownership transfer, TEMP stage, transaction
generation, terminal reader and post-DDL fence. The old B2 owner/capture can no
longer publish.

All four consumed original receipts fail their normal assert/read surfaces.
The migration fence remains provable through the migration tombstone and
adoption receipt chain. Adoption receipt assert and snapshot read re-run the
canonical full terminal-reader proof; mutation of prepare count, execute count,
ownership acquisition, retained rows or expected projection poisons all three
layers instead of leaking a stale snapshot.

The adoption path emits only the frozen read-only SQL allowlist used for live
proof. It issues no write PRAGMA, permanent write, transaction control or
connection/cursor rebind.

## Test corpus

Five new test modules contain 119 collected cases and 2,618 lines.

| File | Cases | Lines | SHA-256 |
|---|---:|---:|---|
| `python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py` | 31 | 1,103 | `f0b37646e22fa991f66733314416cad34c5709f0c8f150aca696a1ea3c3ee17f` |
| `python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py` | 17 | 510 | `25455df61fe12c4edc7218c1126859c16b493c8f025bf7efe748ebefaaccea50` |
| `python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py` | 41 | 370 | `834e3ad62475611fba6273d5fd03722d6283c8038e256da58379cc4d53a1c36d` |
| `python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py` | 21 | 194 | `03de40d9619cb094e9859d1bdda2ffe92881fec9af219fb0ce5f96c02ce9df8d` |
| `python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py` | 9 | 441 | `c10935553430abe788aad1ba4ddc9e0eef9f7937d7afb432a0215327147865eb` |

Coverage includes:

- the valid exact `4/4/1` control and exact snapshot shape;
- malformed and hostile carrier matrices without caller dispatch;
- cancellation placement, registry deltas, retry and reproof;
- every authenticated validation seam before allocation;
- lower prepare, retire, poison, publish and replay behavior;
- ten authenticated graph-corruption slots;
- complete foreign graphs and foreign typed tombstones in every slot;
- five allocation, five record, nine registration and six weak-reference
  failure positions;
- exact ledger formulas and every write counter;
- ten post-adoption reader reproof mutations;
- eleven cancelled-preparation retry drift positions;
- recursive atomic-tail source and bytecode closure;
- exact 34-object catalog, terminal reader and transitive consumption graph;
- exact read-only SQL trace;
- weak-registry cleanup and whole-graph garbage collection;
- package-root runtime and external-mypy surface closure.

Final focused command:

```text
uv run --project python pytest -q \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py
```

Result: **119/119 passed in 632.47 seconds** on the final formatted bytes.

## Defect chronology

Independent review was allowed to reject each candidate rather than treating a
green focused path as completion. The material findings and closures were:

1. a combined-suite garbage-collection observer retained a graph transiently;
   the observer now collects before measuring and the focused and combined
   paths agree;
2. the outer publication wrapper initially left post-cancellation allocation
   and registration exceptions outside terminal cleanup; the wrapper now owns
   the complete post-cancel tail and poisons/reset-cleans every partial record;
3. initial validation originally sampled only a subset of terminal-reader
   commitments; it now invokes the canonical complete reader proof;
4. adoption receipt assert/read originally repeated the same partial proof;
   both now re-run the canonical terminal-reader proof;
5. the recursive forbidden-effect test initially stopped at the wrapper and
   missed its captured `perform_tail`; it now walks wrapper, perform-tail,
   ownership and stage closures;
6. a stage final-publish validation failure could meet an already-poisoned
   ownership bridge and fail to propagate stage poison; only the poison path now
   accepts that internal intermediate state, while retire continues to reject
   it. A real full-outer probe proves the terminal transition and double burn.

No finding was waived. After the final fixes, two independent read-only audits
reported **HIGH 0 / MEDIUM 0 / LOW 0**.

## Validation evidence

The following gates ran against the final production bytes unless explicitly
marked otherwise.

| Gate | Result |
|---|---|
| Ruff check, Ruff format check, `py_compile`, `git diff --check` over all eight subject files | pass |
| mypy over all three production modules | pass |
| focused initial-stage adoption corpus | 119/119, 632.47 s |
| lower stage + ownership focused corpus | 118/118, 52.21 s |
| independent stage-final-publish full-outer probe | 1/1 |
| independent audit A | H0 / M0 / L0 |
| independent audit B | H0 / M0 / L0 |
| SQLite ledger contract plus strict validators | 61/61, pass |
| fixture validator | 85 JSON fixtures, 44 case manifests, pass |
| SQLite migration source/mirror closure | 6/6, pass |
| npm package content and dry-run tarballs | 9/9, pass |
| packed npm install and smoke | 9/9, pass |
| Python wheel and sdist build/install smoke | 114 wheel / 115 sdist entries, pass |
| SQLite TypeScript typecheck | pass |
| TypeScript/Python frozen descriptor contract parity | 1/1, pass |
| pre-rebind semantic parity campaign | 70/70 TypeScript and 70/70 Python; no parity differences; pass |
| final complete Python regression | 3,908 passed plus 2 subtests, zero failures, 3,611.79 s (1:00:11), exit 0 |

### Interrupted complete-suite attempts

Two earlier invocations used `uv run --project python pytest -q` and were
deliberately interrupted when review found defects in non-final candidates.

| Attempt | Candidate identity | Stop reason and terminal evidence |
|---|---|---|
| 1 | A pre-wrapper-closure working tree; an exact SHA snapshot was not preserved | Review found post-cancellation exception-closure and complete-reader-proof defects. The operator interrupted the run. No signal/exit code or pytest terminal summary was retained, so the attempt has no pass/fail conclusion. |
| 2 | A later non-final working tree; its exact simultaneous production/test SHA set was not durably retained | Review found the post-adoption reader-reproof and already-poisoned ownership propagation defects. The operator interrupted the run. The last observed progress output was `2395 passed in 887.99s` near 62%; pytest emitted no terminal suite summary and the shell exit/signal was not retained. |

The missing snapshot/exit metadata for attempt 1 and missing terminal metadata
for attempt 2 are recorded as evidence deficiencies, not reconstructed. Partial
progress from the two attempts is not added together and establishes neither a
pass nor a failure. Neither attempt is acceptance evidence for the final byte
set.

Only the uninterrupted final complete regression recorded above may close the
whole-suite gate.

### Reproduction commands

The durable commands behind the validation table are:

```text
python/.venv/bin/ruff format --check \
  python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py \
  python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py \
  python/src/graph_engineering/sqlite_operation_baseline_stage.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py
python/.venv/bin/ruff check \
  python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py \
  python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py \
  python/src/graph_engineering/sqlite_operation_baseline_stage.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py
PYTHONDONTWRITEBYTECODE=1 python/.venv/bin/python -m mypy --no-incremental \
  python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py \
  python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py \
  python/src/graph_engineering/sqlite_operation_baseline_stage.py
python/.venv/bin/python -m py_compile \
  python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py \
  python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py \
  python/src/graph_engineering/sqlite_operation_baseline_stage.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py
git diff --check -- \
  python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py \
  python/src/graph_engineering/sqlite_operation_baseline_cursor_stage_ownership.py \
  python/src/graph_engineering/sqlite_operation_baseline_stage.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_hostile.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_contract_closure.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_reproof.py \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py

uv run --project python pytest -q \
  python/tests/test_sqlite_operation_baseline_stage.py \
  python/tests/test_sqlite_operation_baseline_cursor_stage_ownership.py
uv run --project python pytest -q \
  python/tests/test_sqlite_cursor_publication_initial_stage_adoption_surface_closure.py::test_stage_publish_gate_failure_propagates_terminal_poison_through_all_layers

corepack pnpm test:sqlite-ledger-contract
corepack pnpm validate:fixtures
corepack pnpm check:sqlite-migrations
corepack pnpm check:packages
corepack pnpm check:packed-install
corepack pnpm check:python-package
corepack pnpm --filter @graph-engineering/sqlite typecheck
corepack pnpm test:sqlite-cursor-publication-contract-parity
corepack pnpm test:sqlite-cursor-pre-rebind-parity

uv run --project python pytest --collect-only -q
uv run --project python pytest -q
```

## Frozen nonclaims

The following remain false after this leaf:

- executable 145-case or normalized 28-field cross-runtime runtime parity;
- publication session and cursor rebind;
- rules 11 and 12;
- the second provider-clock boundary;
- lineage or metadata row publication;
- final semantic audit;
- TEMP catalog retirement;
- commit or rollback authority;
- active-v2 manifest;
- `implementationClaim`, `activeManifestClaim` and `protocolClaim`;
- release-candidate, stable, production-use or external-adoption status;
- any guaranteed star count or popularity outcome.

The 28-field Python adoption snapshot is a necessary local proof surface. It is
not by itself the cross-runtime normalized evidence required later in the plan.

## Next authorized leaf

After this milestone is committed and pushed, the smallest safe next leaf is
the three-control real-SQLite TypeScript/Python 28-field parity gate described
by §§31.37.38.3 and 31.37.21.6:

- `initial-publication-success-control`;
- `initial-publication-invalid-adoption-bundle`;
- `initial-publication-post-0002-catalog-drift`.

The complete 145-record campaign includes later publication-session, rebind and
retirement states that are not implemented yet. It must remain staged rather
than being falsely claimed by this adoption leaf.
