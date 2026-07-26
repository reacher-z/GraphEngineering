# `@graph-engineering/primitives`

Small, model-free orchestration primitives with deterministic, portable
results. The alpha package contains settled-barrier and route-selection
evaluators.

```ts
import { evaluateSettledBarrier } from "@graph-engineering/primitives";

const result = evaluateSettledBarrier(
  [
    { id: "research", status: "succeeded", value: { findings: 3 } },
    { id: "security", status: "timed_out" },
  ],
  { kind: "minimum", minimum: 1 },
);

// result.satisfied === true
// result.acceptedIds === ["research"]
```

## Settled barrier contract

Items are already terminal when evaluated. IDs must be unique safe identifiers.
A `succeeded` item requires a portable JSON `value`; all other statuses forbid
`value`. Portable JSON permits finite non-integer doubles but limits integers to
`[-(2^53-1), 2^53-1]`.

Policies are exact tagged unions:

- `{ kind: "all" }` requires every item to succeed;
- `{ kind: "minimum", minimum }` requires at least that many successes;
- `{ kind: "percentage", basisPoints }` compares
  `succeeded * 10000 >= total * basisPoints`, using integer arithmetic only.

An empty set is always unsatisfied with `NO_ITEMS`. A minimum larger than the
set is valid and returns `MINIMUM_EXCEEDS_TOTAL`. Result IDs preserve declaration
order. Results and their arrays are detached and frozen.

Invalid inputs throw `PrimitiveValidationError` with stable
`PRIMITIVE_VALIDATION` and ordered `{ path, code, message }` issues. Unknown
fields are rejected. Validation errors never retain caller-owned values.

Pipeline, streaming, waiting, timers, retries, model calls, and side effects are
outside this package's current alpha scope.

## Route selection

`evaluateRouteSelection(request, policy)` separates an untrusted requested
classification from deterministic control flow. A policy declares every allowed
route in canonical order and chooses `single` or bounded `multi` selection.

```ts
import { evaluateRouteSelection } from "@graph-engineering/primitives";

const selection = evaluateRouteSelection(
  { requestedRoutes: ["security"], confidenceBasisPoints: 8200 },
  {
    kind: "single",
    allowedRoutes: ["quick", "security", "human"],
    defaultRoute: "human",
    confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
  },
);
```

Requests and policies are closed shapes. Route IDs use the same safe identifier
contract as settled items. Allowed-route declaration order controls output order;
request order is retained only for audit. Multi policies require an explicit
`maxMulticast` and never truncate an oversized selection.

A configured confidence gate requires request confidence in integer basis points.
Low confidence selects only the explicit escalation route before empty, unknown,
or count handling. Without low-confidence escalation, an explicit default handles
only empty or unknown requests; it never masks single-selection or multicast
limit violations. Unknown routes are never silently dropped.

After strict validation and snapshotting, the exact state precedence is:

1. low-confidence escalation;
2. empty-request default or `NO_REQUESTED_ROUTE`;
3. single/multicast count violation;
4. unknown-route default or `UNKNOWN_ROUTE`;
5. canonical allowed-route selection.

Every result reports the original request, canonical selected routes, unknown
routes, confidence, default/escalation flags, and a stable reason code. The
invariant `routed === (selectedRoutes.length > 0)` always holds. Validation uses
the same ordered `PrimitiveValidationError` envelope and never executes accessors.
