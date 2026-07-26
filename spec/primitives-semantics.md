# Execution primitive semantics v1alpha1

This document freezes the first language-neutral primitive contract. Primitives
are deterministic plumbing: they do not call models, tools, clocks, random
sources, storage, or the network.

## Settled barrier

`evaluateSettledBarrier` in TypeScript and `evaluate_settled_barrier` in Python
evaluate an already-settled collection. They do not wait for work or change an
item's status.

Each item has exactly these fields:

```json
{"id":"worker-1","status":"succeeded","value":{"answer":42}}
```

- `id` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`; `.` and `..` are
  forbidden. IDs compare exactly, without case folding or Unicode
  normalization, and must be unique.
- `status` is `succeeded`, `failed`, `missing`, or `timed_out`.
- A succeeded item owns a `value` field, including when its value is `null`.
  Other statuses must not have `value`.
- Values are detached portable finite JSON. Integers are limited to
  `[-9007199254740991, 9007199254740991]`; finite fractional IEEE-754 values are
  allowed. Cycles, aliases to mutable output, accessors, sparse arrays, custom
  objects, non-string keys, and non-JSON runtime values are rejected.

Policies use one of three closed shapes:

```json
{"kind":"all"}
{"kind":"minimum","minimum":2}
{"kind":"percentage","basisPoints":6667}
```

`minimum` is a safe integer of at least one. A minimum larger than the total is
a valid, unsatisfied evaluation. `basisPoints` is an integer from 1 through
10000. Percentage satisfaction is evaluated exactly as
`succeeded * 10000 >= basisPoints * total`; no floating-point ratio or rounding
mode is involved.

Wire integers are mathematical JSON integers. A runtime with separate integer
and floating types accepts a finite built-in `1.0` wherever JavaScript's
`Number.isSafeInteger(1.0)` is true and normalizes it to integer `1`; fractional,
non-finite, subclass, and boolean values remain invalid. Signed zero in a field
whose range includes zero normalizes to positive integer zero.

An empty collection is unsatisfied under every policy. The result is the exact
portable shape below. ID arrays preserve item declaration order.

```json
{
  "satisfied": false,
  "reasonCode": "ALL_NOT_SUCCEEDED",
  "total": 3,
  "succeeded": 1,
  "failed": 1,
  "missing": 0,
  "timedOut": 1,
  "acceptedIds": ["worker-1"],
  "failedIds": ["worker-2"],
  "missingIds": [],
  "timedOutIds": ["worker-3"]
}
```

The stable reason codes are:

- `NO_ITEMS`
- `ALL_SUCCEEDED`
- `ALL_NOT_SUCCEEDED`
- `MINIMUM_MET`
- `MINIMUM_NOT_MET`
- `MINIMUM_EXCEEDS_TOTAL`
- `PERCENTAGE_MET`
- `PERCENTAGE_NOT_MET`

The returned value is detached from all caller-owned objects. TypeScript freezes
it recursively. Python exposes an immutable result and an exact JSON projection.

## Validation failures

Invalid calls raise `PrimitiveValidationError`. Its stable code is
`PRIMITIVE_VALIDATION`, and `issues` is an ordered collection of
`{path, code, message}`. Paths use JSON Pointer rooted at `#`. Implementations
may improve human messages without changing issue paths or codes in a protocol
release. Stable issue codes are `TYPE`, `REQUIRED`, `UNKNOWN_FIELD`, `UNSAFE_ID`,
`DUPLICATE_ID`, `INVALID_STATUS`, `STATUS_VALUE_MISMATCH`, `INVALID_JSON`, and
`INVALID_POLICY`.

Validation never executes an accessor and never returns a caller-owned mutable
value. Evaluation begins only after both arguments have passed validation and
snapshotting.

## Current boundary

This primitive evaluates settled data. Scheduler-integrated deadlines, durable
partial arrival, quorum voting, and cancellation are separate runtime contracts
and are not implied by this API.

## Route selection

`evaluateRouteSelection` in TypeScript and `evaluate_route_selection` in Python
turn an already-validated classifier decision into a deterministic set of route
keys. The evaluator does not execute an edge.

The request wire shape is closed:

```json
{"requestedRoutes":["security"],"confidenceBasisPoints":7200}
```

`requestedRoutes` may be empty. Its route keys use the same safe-ID rules as
settled items and must be unique. `confidenceBasisPoints`, when required by the
policy, is an integer from 0 through 10000.

The policy wire shape is:

```json
{
  "kind":"multi",
  "allowedRoutes":["correctness","security","performance","human"],
  "defaultRoute":"human",
  "confidence":{"minimumBasisPoints":7000,"escalationRoute":"human"},
  "maxMulticast":3
}
```

- `kind` is `single` or `multi`.
- `allowedRoutes` is non-empty, unique, and its declaration order is canonical
  selection order.
- `defaultRoute` and `confidence.escalationRoute` must be allowed.
- `multi` requires `maxMulticast` from one through the allowed-route count;
  `single` forbids it.
- Confidence configuration is all-or-nothing. When `confidence` exists, the
  request must own `confidenceBasisPoints`; when it does not, the request must
  not contain that field.

Evaluation happens only after both closed inputs validate. The branch priority
is normative:

1. confidence below the configured threshold selects only the escalation route;
2. an empty request selects an explicit default or remains unrouted;
3. multiple routes in `single`, or more than `maxMulticast` in `multi`, remains
   unrouted—default never masks a count violation;
4. any unknown route selects the explicit default for the whole request, or
   remains unrouted—known routes are never silently accepted beside unknowns;
5. otherwise requested routes are selected in `allowedRoutes` declaration order.

Low-confidence escalation is intentionally the only decision that takes
precedence over count and unknown-route outcomes. Equality with the confidence
threshold follows the normal route path.

The exact result shape is:

```json
{
  "routed": true,
  "reasonCode": "REQUESTED_ROUTES_SELECTED",
  "requestedRoutes": ["security"],
  "selectedRoutes": ["security"],
  "unknownRoutes": [],
  "confidenceBasisPoints": 7200,
  "usedDefault": false,
  "escalated": false
}
```

`requestedRoutes` and `unknownRoutes` preserve request order. `selectedRoutes`
uses allowed-route order. `routed` is true exactly when `selectedRoutes` is
non-empty. The stable reason codes are `REQUESTED_ROUTES_SELECTED`,
`DEFAULT_SELECTED_NO_REQUEST`, `DEFAULT_SELECTED_UNKNOWN_ROUTE`,
`ESCALATION_SELECTED_LOW_CONFIDENCE`, `NO_REQUESTED_ROUTE`, `UNKNOWN_ROUTE`,
`MULTIPLE_ROUTES_FOR_SINGLE`, and `MULTICAST_LIMIT_EXCEEDED`.

Route validation uses the existing primitive error envelope and may additionally
emit `DUPLICATE_SELECTION`, `INVALID_CONFIDENCE`, and
`CONFIDENCE_CONFIGURATION`. Results are detached and immutable under the same
language rules as settled barriers.

The current ready-queue schedulers do not apply these selections to conditional
edges. Scheduler routing requires a separately versioned lowering and recorded
`RouteSelected` event; this pure evaluator must not be presented as that runtime
integration.
