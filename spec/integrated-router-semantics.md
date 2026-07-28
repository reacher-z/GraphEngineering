# Integrated router semantics v1alpha1

Status: compiler-contract candidate, revision 2. Conditional-edge runtime
behavior already exists in TypeScript and Python. The diagnostics and pattern
lowering below are acceptance work until the patterns package and both
compilers consume the shared corpus in one atomic tranche.

The normative corpus is `spec/conformance/integrated-router.case.json`.

## Scope

This revision freezes:

- direct `RouteSelectionPolicy` validation on `router` nodes;
- the registered `RouteEquals` condition family and its ownership boundary;
- allowed-route membership, route-key uniqueness, downstream-target
  uniqueness, and exhaustive route coverage;
- backward-compatible `routedBranches` policy lowering; and
- the already implemented scheduler projections for selection, pruning,
  descendants, joins, named outputs, defaults, multicast, and forged results.

It does not add a durable route-decision event, replay partition, integrated
barrier/quorum/deadline protocol, human gate, model call, catch-all condition,
or public scheduler validation bypass. The existing pure barrier evaluator and
existing `barrier` node behavior remain separate.

## Canonical declarations

### Router policy

A router is an ordinary Graph IR node with `kind: "router"`. Its `config` is
directly the policy; no `config.policy` wrapper or inference from edges or
metadata is permitted.

```text
SingleRouteSelectionPolicy {
  kind: "single"
  allowedRoutes: non-empty unique SafeRouteId[]
  defaultRoute?: member of allowedRoutes
  confidence?: {
    minimumBasisPoints: integer 1..10000
    escalationRoute: member of allowedRoutes
  }
  // maxMulticast forbidden
}

MultiRouteSelectionPolicy {
  kind: "multi"
  allowedRoutes: non-empty unique SafeRouteId[]
  defaultRoute?: member of allowedRoutes
  confidence?: same exact object as above
  maxMulticast: integer 1..allowedRoutes.length
}
```

`SafeRouteId` matches `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` and is neither `.` nor
`..`. Numeric integers are finite mathematical integers within the portable
JSON safe-integer range. Thus JSON `1.0` is accepted as integer one in both
languages, while booleans are never integers. Objects and arrays are exact:
unknown fields, duplicates, unsafe IDs, and explicit null optionals are
invalid. Omission, not null, selects optional behavior.

Graph capture and the Graph envelope run before this validator. Accessors,
proxies, sparse arrays, non-data properties, cycles, non-portable numeric
values, and other values that cannot enter portable Graph IR are
`GE1007_INVALID_GRAPH`; they are never relabeled GE1401. Graph IR intentionally
allows portable JSON `config` values generally, so a router's portable null,
scalar, or array config is GE1401 at the config root. GE1401 owns every
portable router config admitted by the earlier gate.

Non-router configs are not interpreted as policies.

### Backward-compatible `routedBranches` lowering

The patterns and compiler changes MUST ship atomically. `RouteEquals` remains
the exact published edge carrier. A future optional `routePolicy` member is
added to `RoutedBranchesOptions`, and lowering follows this table:

1. Normalize branch keys once in the same deterministic order used to emit
   branch nodes and edges. That ordered set is `branchRoutes`.
2. If `routePolicy` is supplied, it MUST be an exact policy whose
   `allowedRoutes` equals `branchRoutes` as an ordered list. The classifier's
   current config MUST be the exact empty object. Lowering clones the
   classifier and writes `routePolicy` directly to `classifier.config`.
3. If `routePolicy` is omitted and classifier config is the exact empty object,
   lowering synthesizes `{kind:"single", allowedRoutes:branchRoutes}`. This is
   the source-compatible path for the currently published standard call.
4. If `routePolicy` is omitted and classifier config is already an exact
   `RouteSelectionPolicy`, its ordered `allowedRoutes` MUST equal
   `branchRoutes`; lowering preserves it.
5. Supplying both a non-empty classifier config and `routePolicy`, using any
   other non-empty config, or mismatching branch routes is a pattern
   construction error before a Graph is returned.

The compiler never performs this synthesis. Its direct config remains
authoritative. Existing source calls remain accepted, but their generated
canonical graph/hash intentionally changes when the synthesized policy first
lands. Pattern tests MUST assert the lowered policy, exact `RouteEquals`
documents, branch equality, and compiler validity.

### Condition registry and RouteEquals

Conditional-edge ownership is keyed by the exact pair `(apiVersion, kind)`.
For `graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1`, the
registry contains:

| kind | owner | D6 behavior |
|---|---|---|
| `RouteEquals` | integrated router | validate the exact D6 shape below |
| `LoopContinue` | loop pattern | preserve as registered; do not emit GE1402 |
| `LoopDryVerdict` | loop pattern | preserve as registered; do not emit GE1402 |
| `LoopVerdictAtBound` | loop pattern | preserve as registered; do not emit GE1402 |

The router-owned carrier is the exact three-field object:

```json
{"apiVersion":"graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1","kind":"RouteEquals","routeKey":"security"}
```

Property order is immaterial. Missing/additional fields, wrong types, or an
unsafe `routeKey` make a claimed RouteEquals malformed. An unregistered
version/kind pair is unsupported. Both produce GE1402. Registered loop
conditions remain compiler-valid and are opaque to this pass: D6 neither
validates their owner-specific fields nor treats them as route cases. Their
existing exact shapes are retained by loop-pattern tests.

As with config, condition null/non-object, hostile containers, and
non-portable values fail the earlier Graph gate as GE1007. An absent condition
is an ordinary edge. GE1402 owns only portable condition objects admitted by
the Graph envelope.

An exact RouteEquals MUST originate at a router, and its `routeKey` MUST be a
member of that router's policy.

## Static route table

For each valid router, supported outgoing RouteEquals edges form a bijection
between `allowedRoutes` and downstream branch nodes:

1. every allowed route occurs exactly once;
2. no route key occurs twice;
3. distinct route cases do not target the same node; and
4. every route key belongs to the policy.

Unconditional and foreign registered conditions do not participate and do
not repair coverage. Duplicate targets are rejected because the scheduler
executes a node once and cannot preserve independently selected multicast
aliases. Shared work belongs after distinct branch nodes.

Both policy kinds require complete coverage. `maxMulticast` limits a request;
it does not authorize omitted cases.

`defaultRoute` is an enumerated policy member, not a catch-all edge. Empty or
unknown requests select it according to the existing evaluator. When omitted,
empty/unknown requests yield a successful `routed:false` result and prune all
conditional branches. Confidence escalation likewise selects its enumerated
route. Compilers MUST NOT infer a default or catch-all edge.

## Compiler diagnostics

Public entry points remain TypeScript `compileGraph(document)` and Python
`try_compile_graph(document)`/`compile_graph(document)`.

| Code | Meaning | Base location |
|---|---|---|
| `GE1401_INVALID_ROUTER_POLICY` | admitted router config is not an exact policy | config root for non-object, otherwise first invalid descendant; node ID |
| `GE1402_UNSUPPORTED_EDGE_CONDITION` | unregistered condition or malformed claimed RouteEquals | first invalid descendant of `#/edges/{i}/condition`; edge ID and source ID |
| `GE1403_CONDITION_SOURCE_NOT_ROUTER` | exact RouteEquals has a non-router source | condition root; edge ID and source ID |
| `GE1404_ROUTE_NOT_ALLOWED` | route key is outside policy | `/routeKey`; edge ID and source ID |
| `GE1405_DUPLICATE_ROUTE_CASE` | later case repeats route key | later `/routeKey`; later edge ID and source ID |
| `GE1406_DUPLICATE_ROUTE_TARGET` | later distinct case repeats target | later `/to/node`; later edge ID; source then target IDs |
| `GE1407_INCOMPLETE_ROUTE_COVERAGE` | valid router lacks allowed cases | policy `/allowedRoutes`; node ID only |

For exact-object validation, “first invalid descendant” is deterministic and
matches the existing primitive: unknown keys first in Unicode code-point
order, then required/present fields in contract order; array elements use
increasing index. The corpus matrix freezes concrete paths. Messages are human-facing but
must name relevant node/edge and route keys. Protocol tests compare only the
projection fields.

### Pass boundary and ordering

The compiler pipeline is frozen as:

1. canonical capture and Graph envelope (`GE1007`, early return);
2. Graph declaration identity and reference diagnostics (`GE1001`..`GE1004`,
   `GE1008`, `GE1009`; existing early-return behavior);
3. topology/cycle (`GE1005`, early return on cycle);
4. entrypoint and reachability diagnostics (`GE1010`, `GE1006`);
5. existing graph policies (`GE1101`, `GE1102`);
6. this router pass; then
7. strict typed ports (`GE1201`..`GE1208`).

Existing diagnostics already accumulated in steps 4-5 precede router
diagnostics. Typed-port diagnostics follow them. Inside the router pass:

1. GE1401 in node declaration order;
2. GE1402 in edge declaration order;
3. GE1403 in edge declaration order;
4. GE1404 in edge declaration order;
5. GE1405 in edge declaration order;
6. GE1406 in edge declaration order; and
7. GE1407 in node declaration order.

The corpus proves both axes independently: two invalid policies on distinct
routers retain node declaration order within GE1401, and two unsupported
conditions on distinct routers retain edge declaration order within GE1402.
Identifiers are intentionally not lexically ordered, so accidental sorting
cannot satisfy either case.

Suppression is local, not a global early return:

- malformed/unregistered conditions receive only GE1402 from this pass;
- exact RouteEquals on non-router receives only GE1403;
- invalid router policy receives GE1401; relational checks and GE1407 for that
  router are suppressed, but independent GE1402 conditions still report;
- a valid router with any malformed/unregistered, non-member, duplicate-key,
  or duplicate-target outgoing route candidate does not also receive GE1407;
- otherwise one GE1407 lists every missing route in policy order; and
- independent routers and independent compiler passes continue reporting.

`canonicalGraph` is the existing canonical serialization of the captured
source Graph, and `graphHash` is lowercase hex
`SHA-256(UTF-8(canonicalGraph))`. Semantic invalidity does not alter these
values where the current compiler already returns them. Corpus hashes are
literal; cross-language self-comparison alone is insufficient.

### Portable diagnostic projection

For each diagnostic, create an object by visiting `code`, `path`, `nodeIds`,
and `edgeId` in that order and copying only fields actually present. Never
materialize an absent field as JSON null. Preserve `nodeIds` element order and
diagnostic order. This omit-if-absent helper is normative in both languages.

## Runtime decision and terminal contract

The built-in router evaluates bound input as `RouteSelectionRequest` and the
compiled direct config as policy. Its successful result is the exact existing
eight-field `RouteSelectionResult`: `routed`, `reasonCode`, `requestedRoutes`,
`selectedRoutes`, `unknownRoutes`, `confidenceBasisPoints`, `usedDefault`, and
`escalated`.

Custom router executors are not authoritative. Before success, the scheduler
recomputes from bound input/policy and requires canonical equality of all
eight fields. A forged or contradictory result is non-retryable
`INVALID_ROUTE_SELECTION` after one attempt.

An edge activates iff its `routeKey` occurs in committed `selectedRoutes`.
Only active edges bind inputs. Portable node terminals are declared in graph
node order and contain node ID, status, attempts, optional output, and optional
failure `{code,retryable}`.

- Selected branches execute; unselected branches settle zero-attempt
  `ROUTE_NOT_SELECTED`.
- Descendants reachable only through pruned work inherit that control
  terminal.
- Mixed active/inactive joins use only active inputs. If an active predecessor
  fails, the join settles `UPSTREAM_FAILED`; inactive siblings do not hide it.
- `ROUTE_NOT_SELECTED` is excluded from graph failure codes.
- An inactive named output makes output binding incomplete and the run failed,
  without inventing a node failure.
- Multi selection preserves allowed-route order; exceeding `maxMulticast`
  yields the existing successful non-routed decision and prunes all branches.
- Unknown selection uses the enumerated default when configured.

There is no public or private precompiled scheduler bypass in this contract.
Compiler-invalid conditions are exercised through compiler/validator cases.
TypeScript public `runGraph(document, ...)` proves zero executor calls; Python
proves `try_compile_graph(document)` is invalid and that no `CompiledGraph` is
available to pass to `run_graph`, leaving the prepared handlers untouched. The historical scheduler
guard remains implementation defense, but the removed `lowerLevelRuntimeOnly`
fixture is not a release gate until a separately reviewed safe internal
surface exists. TypeScript public runtime consumes a document; Python's public
`run_graph` consumes a compiled graph but its scheduler recompiles its captured
spec, so both enforce the compiler boundary.

## Conformance requirements

A conforming pair MUST consume the literal corpus and prove:

1. exact diagnostic projection, order, cascades, and omit-if-absent behavior;
2. policy and condition-registry matrix parity, including JSON `1.0` and
   boolean rejection;
3. registered loop conditions remain valid;
4. condition null/non-object and host-exotic cases remain GE1007, while
   portable router config null/scalar/array cases are GE1401;
5. literal canonical graph hashes in both languages;
6. zero executor calls at the applicable TypeScript run/Python compile gate;
7. all runtime cases on real named public execution surfaces;
8. exact decisions, terminals, attempts, calls, outputs, and failure codes;
9. atomic `routedBranches` lowering and branch-policy equality tests; and
10. existing core, patterns, primitives, scheduler, and durable suites remain
    green.

Normal tests use deterministic executors. Provider calls, wall-clock timing,
durable event claims, and unsafe validation bypasses are outside this tranche.
