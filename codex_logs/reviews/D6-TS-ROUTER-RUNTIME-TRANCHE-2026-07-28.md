# D6 TypeScript Router Runtime Tranche Review — 2026-07-28

## Verdict

Accepted as a bounded first tranche of `D6-ROUTER-BARRIER-023`, not as closure
of D6. The TypeScript scheduler now executes the existing package-owned
`RouteEquals` annotation, validates every router decision by deterministic
policy recomputation before a success journal entry, records inactive nodes as
structured control skips, propagates inactive control flow, and reconstructs
the same decisions from durable history without invoking a router again.

## Implemented contract

- Router configuration is the existing `RouteSelectionPolicy` from
  `@graph-engineering/primitives`.
- A router with no node- or kind-specific executor uses
  `evaluateRouteSelection(input, node.config)`.
- The only executable condition in this tranche is the exact three-field
  annotation `{apiVersion, kind: "RouteEquals", routeKey}` under
  `graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1`.
- Conditional edges require a `router` source. Unsupported, malformed, or
  non-router conditions fail their source before an attempt with
  `UNSUPPORTED_EDGE_CONDITION`; multiple findings are sorted by edge ID and
  retained in the message.
- Successful router output must have the exact eight primitive result fields.
  Its requested routes and confidence evidence are fed back through
  `evaluateRouteSelection` with the frozen node policy, and canonical output
  must match exactly. A forged or contradictory result becomes the terminal,
  non-retryable `INVALID_ROUTE_SELECTION` before `nodeSucceeded`.
- An unselected target is `skipped` with `ROUTE_NOT_SELECTED`, zero attempts,
  and no executor call. That control skip is not a graph-level failure. Its
  outgoing edges are inactive, and downstream nodes bind only active inputs.
- All structural predecessors still settle before a target is considered, so
  this tranche changes routing, not the scheduler's dependency-completion
  barrier.
- Durable resume revalidates successful router results before `RunResumed`,
  rejects self-consistent forged history, derives active inputs identically,
  accepts route-skip terminal history, and never rejudges a terminal route.

## Changed files

- `packages/runtime/src/router-runtime.ts`
- `packages/runtime/src/scheduler.ts`
- `packages/runtime/src/durable.ts`
- `packages/runtime/src/types.ts`
- `packages/runtime/test/scheduler.test.ts`
- `packages/runtime/test/durable.test.ts`
- `packages/runtime/package.json`
- `pnpm-lock.yaml`

## Verification evidence

- Focused scheduler plus durable suite: 2 files, 85 tests passed.
- Full `@graph-engineering/runtime` test command: passed.
- Runtime typecheck, lint, and build: passed.
- Adjacent `@graph-engineering/core`: 166/166 tests passed.
- Adjacent `@graph-engineering/primitives`: 147/147 tests passed.
- Adjacent `@graph-engineering/patterns`: 93/93 tests passed.
- Scoped `git diff --check`: passed.
- Hostile coverage includes forged selected routes, duplicate/non-string route
  IDs, invalid policy/result recomputation, malformed and unsupported
  conditions, non-router sources, zero-match routing, low-confidence
  escalation, inactive propagation, mixed fan-in, invalid restored success,
  inactive named output, authoritative-input substitution, malformed built-in
  requests, invalid policies, committed zero-attempt condition-failure resume,
  attempted unsupported sources, attempted inactive branches, and
  self-consistent durable-output forgery.

## Explicit nonclaims and residual risk

### High — outside this tranche, still blocks D6 closure

- No integrated all/minimum/percentage/quorum/deadline barrier settlement.
- No early barrier release, deadline timer, partial/missing/timed-out statistics,
  or barrier checkpoint/replay contract.
- No canonical `RouteSelected` event, selected-edge-only durable emission, or
  shared TS/Python durable route-decision fixture.

### Medium

- Router exhaustiveness and allowed-route-to-edge coverage are not yet compiler
  diagnostics. Runtime fails closed for unsupported condition syntax, while
  policy completeness and route coverage remain a future canonical spec/core
  compiler tranche.
- Conditional dependency completion remains a structural wait for every
  predecessor; it does not yet provide streaming or early-quorum latency.
- Direct internal `initialResults` accepts failure/skip seeds under the
  existing scheduler contract; durable callers receive stronger history-fold
  validation.

### Low

- Human-readable condition messages are deterministic but are not yet a
  versioned cross-language conformance artifact.

No high, medium, or low defect is known inside the implemented RouteEquals
execution and durable-validation slice after the listed gates. The risks above
are scope omissions that must remain visible until later D6 tranches close
them.
