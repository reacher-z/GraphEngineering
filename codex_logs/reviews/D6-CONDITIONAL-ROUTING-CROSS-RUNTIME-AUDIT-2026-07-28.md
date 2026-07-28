# D6 conditional-routing cross-runtime audit — 2026-07-28

## Disposition

Final independent disposition: **H0 / M0 / L0** for the bounded
`RouteEquals` conditional-routing tranche after remediation. This disposition
does not close the full `D6-ROUTER-BARRIER-023` plan item.

Reviewed paths:

- `packages/runtime/src/router-runtime.ts`
- `packages/runtime/src/scheduler.ts`
- `packages/runtime/src/durable.ts`
- `packages/runtime/src/types.ts`
- `packages/runtime/test/scheduler.test.ts`
- `packages/runtime/test/durable.test.ts`
- `python/src/graph_engineering/scheduler.py`
- `python/src/graph_engineering/durable.py`
- `python/tests/test_scheduler.py`
- `python/tests/test_durable_scheduler.py`
- the TypeScript and Python runtime README additions

The review compared the fixed annotation, source-side structural failure,
router request/config/output binding, inactive propagation, mixed joins,
attempt accounting, non-retry behavior, journal ordering, partial-history
resume, forged restored results, terminal output/failure reconstruction and
cross-runtime failure identities.

## Findings closed during review

### H1 — custom router could replace authoritative request evidence — closed

The first implementation recomputed a custom router result from
`requestedRoutes` and `confidenceBasisPoints` carried by that same result. A
custom executor could therefore replace both the request and selected route
with an internally self-consistent decision. A live Python reproduction routed
an authoritative `quick` request to `audit` and incorrectly succeeded.

Both runtimes now recompute from the scheduler-bound node input and the frozen
node policy, then require the returned eight-field result to equal that
decision. Durable verification uses the committed scheduled input, not fields
supplied only by the output. Live, restored-seed and resigned-history tests
cover the attack.

### H2 — legitimate unsupported-condition partial history could not resume — closed

After `NodeSettledWithoutAttempt` for an unsupported-condition source was
durably committed, a simulated process loss produced a legitimate nonterminal
history. The first restored-result preflight rejected that exact structural
failure merely because the source owned an unsupported condition. A Python
reproduction leaked `TypeError` from resume.

Both schedulers now accept only the exact zero-attempt
`UNSUPPORTED_EDGE_CONDITION` restored result and reject every other restored
shape. Durable hostile checks also reject attempt-bearing history for a source
that must have failed structurally. Commit-then-loss resume tests cover the
legal history.

### H3 — inactive branch could be forged as scheduled in TypeScript history — closed

The first TypeScript durable input binder filtered structural incoming edges
before checking for a root. An inactive-only node therefore looked like a root
and could accept graph input in a forged `NodeScheduled` event. It now
distinguishes no structural dependency from no active dependency and rejects
the latter. A resigned-history test covers attempted inactive execution.

### M1 — TypeScript inactive named output contradicted its own terminal — closed

The scheduler excludes `ROUTE_NOT_SELECTED` from graph failures, including when
the skipped node is a named graph output. The first TypeScript terminal
validator re-added that failure and rejected a terminal history emitted by the
same runtime. The validator now preserves the scheduler algebra: incomplete
output, failed run, no graph failure entry. Start/resume exact equality is
covered.

### M2 — Python fold reordered interleaved scheduled nodes — closed

Two added full-list sorts changed first-event order when a fast branch scheduled
its child before a slower branch later produced a zero-attempt descendant. A
reproduction generated terminal order `a, b, b-child, a-child` and resume
reconstructed `a, b, a-child, b-child`, causing `INVALID_RUN_HISTORY`. The
sorts were removed; fold now preserves event order and an interleaved durable
test proves terminal resume.

### M3 — TypeScript built-in router validation was retryable generic failure — closed

The attempt wrapper initially labelled a thrown `InvalidRouteSelectionError`
as `NODE_EXECUTION_FAILED` before the node layer could classify it. Invalid
request/policy could therefore retry in TypeScript while Python returned the
non-retryable `INVALID_ROUTE_SELECTION`. TypeScript now lets the error identity
override the generic outcome code. Malformed request and invalid policy tests
prove one attempt, one terminal failure journal entry and no reservation.

## Final cross-runtime observations

- The executable condition is the exact three-field, versioned
  `RouteEquals` annotation. Malformed annotations and use from a non-router
  source settle the source before an attempt with
  `UNSUPPORTED_EDGE_CONDITION`.
- Multiple structural condition errors are sorted by edge ID and joined in the
  same order and wording in both runtimes.
- A router decision is an exact eight-field value and is bound to authoritative
  input plus frozen policy. Invalid decisions are terminal
  `INVALID_ROUTE_SELECTION` failures and do not consume retry capacity beyond
  the failed attempt.
- Inactive nodes and inactive-only descendants settle with
  `ROUTE_NOT_SELECTED`, zero new attempts and no graph-failure entry. A mixed
  join receives only active successful bindings.
- Active failed inputs still produce `UPSTREAM_FAILED`; inactive failures do
  not poison a mixed join.
- Durable fold rejects router-output, scheduled-input, unsupported-source and
  inactive-branch forgeries before appending resume work.
- Restored attempt offsets and total-attempt accounting remain intact for
  zero-attempt structural settlements and non-retryable router failures.
- Terminal nodes remain in deterministic graph order; scheduled and completion
  orders preserve their defined first-event/commit orders rather than being
  normalized after the fact.

## Final low-finding closure

The former L1 hostile-test symmetry gap is closed. Python now takes the
legitimate zero-attempt `security` settlement from a `quick` route run, resigns
it as an attempt-bearing `NodeScheduled` event with internally consistent input,
input hash, activity key and payload hash, and proves resume rejects the history
as `INVALID_RUN_HISTORY` because the route was unselected. This is the direct
counterpart of the TypeScript resigned inactive-branch attack.

## Verification evidence

- `corepack pnpm --filter @graph-engineering/runtime test -- --run`:
  **11 files, 243 tests passed**.
- `corepack pnpm --filter @graph-engineering/runtime typecheck`: passed.
- `corepack pnpm --filter @graph-engineering/runtime lint`: passed.
- `corepack pnpm --filter @graph-engineering/runtime build`: passed.
- `uv run --project python pytest -q python/tests/test_scheduler.py python/tests/test_durable_scheduler.py`:
  **94 passed**.
- scoped Ruff check: passed.
- scoped Ruff format check: passed, four files already formatted.
- strict MyPy for the two changed Python runtime modules: passed.
- scoped `git diff --check`: passed.

## Explicit nonclaims

This tranche does not implement or claim:

- quorum or deadline barrier scheduling;
- compiler route exhaustiveness/default diagnostics;
- arbitrary conditional expressions beyond the fixed `RouteEquals` contract;
- a dedicated `RouteSelected` durable/trace event identity;
- full D6 trace and CLI presentation closure; or
- full `D6-ROUTER-BARRIER-023` acceptance.

The current barrier behavior is the existing deterministic active-input join.
The omitted quorum/deadline work is an explicit follow-up and was not treated
as a defect in this audit.
