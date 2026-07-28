# D6 Python integrated router runtime audit — 2026-07-28

## Accepted tranche

This review accepts the first Python runtime tranche of
`D6-ROUTER-BARRIER-023`; it does not accept the complete D6 task.

The tranche implements the existing versioned `RouteEquals` annotation as an
executable conditional edge. A router without a custom handler evaluates its
node input as the existing `RouteSelectionRequest` against `node.config` as the
existing `RouteSelectionPolicy`. Custom router output is accepted only after
the exact eight-field `RouteSelectionResult` shape is checked and independently
recomputed through `evaluate_route_selection`; a contradictory decision fails
on the router before `node_succeeded` can be journaled and is not retried.

Every unsupported or malformed outgoing condition is collected by source in
edge-ID order. The source settles as `failed/UNSUPPORTED_EDGE_CONDITION` with
zero attempts before an executor runs. A supported `RouteEquals` edge is active
only when the committed router result contains its `routeKey`. A node with
structural inputs but zero active inputs settles as
`skipped/ROUTE_NOT_SELECTED`; its unconditional downstream edges remain
inactive. Mixed joins bind only active successful inputs. Control-flow skips
remain visible on node results but are excluded from graph-level failures.

Durable start/fold/resume accepts and revalidates the new terminal algebra.
Invalid successful router decisions are rejected from restored results and
durable history. The fold reconstructs logical scheduled order in compiled
declaration order, preventing synchronous zero-attempt settlements from making
a valid terminal result disagree with event arrival order; completion order
continues to follow committed event order.

## Evidence

- Focused scheduler and durable suite after independent-review remediation: 93 passed.
- Final full Python suite after the parity regression: 1,749 passed plus two
  nested subtests.
- Ruff changed-file check: green.
- Ruff changed-file format check: green.
- Strict MyPy for `scheduler.py` and `durable.py`: green.
- Scoped `git diff --check`: green.

## Explicit nonclaims and remaining D6 work

- No compiler rejection of incomplete/non-exhaustive single or multicast
  routers is claimed.
- No quorum, deadline, partial-arrival, abstain, unknown, or human-gated barrier
  runtime is claimed.
- No first-class `RouteSelected` event, route decision identity, or durable
  zero-rejudgment replay contract is claimed. The existing durable node result
  is revalidated, but this is not the final route-event protocol.
- No shared D6 spec/conformance fixture, CLI visibility, trace event, or
  cross-runtime release acceptance is claimed.
- Existing `EdgeEmitted` durability records still describe producer output
  publication, not final active/inactive route-decision events.

## Risk register

- High: none within this tranche.
- Medium: complete D6 remains open until shared compiler/runtime/durable event
  contracts and quorum/deadline barriers are implemented in both languages.
- Low: runtime condition validation currently occurs pre-dispatch rather than in
  the compiler; it fails closed with a structured source terminal, but a later
  compiler diagnostic must reject the same graph earlier.

## Post-review durability and authority closure

A second independent review found and closed three defects before integration:

1. Durable fold no longer sorts `scheduled_order`. Journal attempts now return
   the committed `NodeScheduled` ordinal, zero-attempt settlements use their
   committed ordinal, and terminal results preserve first-event scheduling
   order. A controlled slow-failure/fast-descendant interleaving proves terminal
   resume equality for `a, b, b-child, a-child` rather than topological sorting.
2. A committed zero-attempt `UNSUPPORTED_EDGE_CONDITION` source settlement is a
   legal recovery seed only when its complete result exactly matches the
   scheduler-derived source failure. Resume continues to the child
   `UPSTREAM_FAILED` settlement with zero attempts. Attempt-bearing history for
   that source is rejected as invalid history.
3. Route decisions are recomputed from the authoritative node input, never from
   `requestedRoutes` copied out of the proposed output. Live execution, restored
   seeds, and durable `NodeSucceeded` folding reject a self-consistent decision
   that substitutes different request evidence.

The post-review focused scheduler/durable suite contains 93 passing tests and
the final complete Python suite contains 1,749 passing tests plus two nested
subtests. Ruff, format check,
strict MyPy, and scoped diff checks are all green.
