# D6 integrated router compiler contract review — 2026-07-28

## Disposition

Accepted as the shared contract candidate for the next
`D6-ROUTER-BARRIER-023` implementation tranche:

- `spec/integrated-router-semantics.md`
- `spec/conformance/integrated-router.case.json`

This review freezes compiler validation and the already implemented runtime
terminal projection. It does not complete D6 and does not claim integrated
barrier, quorum, deadline, decision-event, trace, CLI, or human-gate support.

## Authoritative compatibility boundary

The contract retains both existing public shapes without translation:

```json
{
  "apiVersion": "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
  "kind": "RouteEquals",
  "routeKey": "quick"
}
```

and direct `node.config` as the pre-existing `RouteSelectionPolicy`:

```json
{
  "kind": "single",
  "allowedRoutes": ["quick", "audit"],
  "defaultRoute": "quick"
}
```

No wrapper such as `config.policy`, no route map, no alternate condition
version, and no catch-all condition was accepted. An isolated Claude draft that
used different shapes remains excluded.

## Contract decisions

The static route table is a bijection from `allowedRoutes` to conditional
downstream branch nodes. Both single and multicast routers require every
allowed route exactly once. Repeated route keys and repeated downstream targets
are rejected. A condition key must be a policy member, and exact `RouteEquals`
may originate only from a router.

`defaultRoute` retains primitive semantics: it selects one enumerated allowed
route for empty or unknown requests. It does not repair a missing known-route
edge. Omission is the defined no-match behavior and yields a successful
`routed:false` decision with all conditional branches pruned. The published
condition version has no catch-all carrier, so incomplete route tables fail
closed.

The compiler diagnostic contract reserves:

| Code | Contract |
|---|---|
| `GE1401_INVALID_ROUTER_POLICY` | direct config is not an exact policy |
| `GE1402_UNSUPPORTED_EDGE_CONDITION` | condition key set/version/kind/value is unsupported |
| `GE1403_CONDITION_SOURCE_NOT_ROUTER` | exact condition has a non-router source |
| `GE1404_ROUTE_NOT_ALLOWED` | condition key is outside `allowedRoutes` |
| `GE1405_DUPLICATE_ROUTE_CASE` | later edge repeats a route key |
| `GE1406_DUPLICATE_ROUTE_TARGET` | later route case repeats a downstream node |
| `GE1407_INCOMPLETE_ROUTE_COVERAGE` | valid router omits one or more allowed routes |

Paths and identity fields are literal in the fixture. Diagnostics are ordered
by category and declaration order. Invalid policy, unsupported condition,
non-router source, non-member routes, and duplicates suppress misleading
coverage cascades as specified.

## Shared corpus inventory

The corpus contains 12 compiler cases:

1. complete single policy with omitted default;
2. complete multicast policy with enumerated default;
3. rejection of a wrapper instead of direct policy;
4. unsupported condition version;
5. extra condition field;
6. exact condition from a non-router;
7. route key outside policy membership;
8. duplicate route key;
9. duplicate downstream target;
10. incomplete single route table;
11. incomplete single route table despite a default; and
12. incomplete multicast route table.

It also contains six current-runtime vectors with exact status, total attempts,
graph output/absence, graph-level failure codes, executor call counts, and node
terminals:

1. one selected diamond branch and active-only merge binding;
2. omitted-default unknown-route no-match;
3. empty-request default selection;
4. low-confidence escalation;
5. custom-output recomputation against authoritative input; and
6. lower-level unsupported-condition defense in depth before dispatch.

The runtime vectors were projected through both current implementations, not
only inferred from tests.

## Exact implementation handoff

### TypeScript compiler lane

Keep `compileGraph(document): CompilationResult`. Extend the public
`DiagnosticCode` union with `GE1401` through `GE1407`. Add a compiler-owned
policy snapshot validator matching the existing primitive contract; `core`
must not introduce a dependency cycle by importing `primitives`. Run the router
pass only after existing schema, identity, and endpoint gates. Emit the literal
fixture `path`, `nodeIds`, and optional `edgeId` fields and preserve category
ordering/cascade suppression.

Required focused tests:

- load all 12 `compilerCases` and compare the four-field diagnostic projection;
- assert every invalid case has `valid:false` and every valid case remains
  compiler-valid;
- assert graph hash/canonical source behavior follows the current compiler
  contract;
- assert public compile-and-run invokes zero executors for compiler-invalid
  cases; and
- retain all current core compiler, patterns, scheduler, and durable router
  tests.

### Python compiler lane

Keep `try_compile_graph`/`compile_graph` behavior. Extend the public
`DiagnosticCode` enum with the same literal strings. Implement the same policy
snapshot and post-structural router pass independently. Python diagnostics
already have `path`, `edge_id`, `node_id`, and optional `node_ids`; project
single ownership as the fixture's one-element `nodeIds` array and use the exact
two-element ordering for a duplicate target.

Required focused tests mirror TypeScript and compare the same corpus without
code translation. `GraphCompileError` must expose the new diagnostics through
the existing API. Existing compiler, scheduler, and durable tests remain
mandatory.

### Cross-runtime acceptance

The implementation tranche is accepted only when:

- all 12 compiler projections match literally in both languages;
- all six runtime projections match the fixture in both languages;
- invalid public compile-and-run inputs call no executors;
- valid default/no-match/confidence decisions retain exact canonical output;
- current defense-in-depth guards remain covered below compilation;
- TypeScript core/runtime typecheck, lint, build, and focused/full tests pass;
- Python Ruff, format check, strict MyPy, and focused/full tests pass; and
- an independent review finds no HIGH or MEDIUM contract/parity issue.

## Verification performed for this contract slice

Strict JSON parsing rejected duplicate keys and confirmed unique compiler/runtime
case names, valid graph references, the exact diagnostic projection, and all
future capability flags set to false.

Current TypeScript evidence:

```text
core compiler: 27/27 passed
runtime scheduler + durable: 85/85 passed
fixture runtime projection: 6/6 passed
```

Current Python evidence:

```text
compiler + scheduler + durable scheduler: 134/134 passed
fixture runtime projection: 6/6 passed
```

Repository checks:

```text
npm run check:docs
Checked 286 local Markdown links.

git diff --check -- spec/integrated-router-semantics.md \
  spec/conformance/integrated-router.case.json
PASS
```

The first attempted npm workspace syntax was not applicable because this root
does not declare npm workspaces. The focused TypeScript commands were rerun from
`packages/core` and `packages/runtime` and passed as recorded above.

## Explicit remaining work

This contract is not implementation evidence for the seven new compiler codes.
The present compilers still accept the compiler-negative route definitions, and
the fixture marks their required future result. After compiler parity, D6 still
requires a dedicated durable route-decision identity/event, zero-rejudge replay
proof, barrier/quorum/deadline settlement with complete statistics, escalation,
cross-runtime event/deadline comparison, trace, and CLI visibility. No task
registry status should change from this contract slice alone.

## Revision 2 correction history — implementability audit remediation

This section supersedes the incompatible statements above without rewriting
the historical review. The independent implementability audit found HIGH 3 /
MEDIUM 4 / LOW 1. Revision 2 changes the candidate contract and corpus; it
still does not claim production implementation.

The original review incorrectly said `routedBranches` already emitted both
public shapes. It emits RouteEquals today but preserves classifier config.
Revision 2 requires an atomic patterns/compiler tranche: an optional
`routePolicy` is lowered directly after exact validation and branch-key
equality; the legacy exact-empty config synthesizes a direct single policy;
matching preconfigured policy is preserved; conflicts, mismatches, and invalid
policies throw before Graph return. The compiler never infers policy. Six
literal lowering cases cover this transition and require the output to compile
in TypeScript and Python.

GE1402 is no longer graph-wide. A registry keyed by exact API version and kind
assigns RouteEquals to D6 and preserves LoopContinue, LoopDryVerdict, and
LoopVerdictAtBound as registered loop-pattern conditions opaque to D6. A full
compiler graph containing all three is expected valid. Portable router config
null/scalar/array is correctly GE1401 because Graph IR permits general JSON
config. Capture-hostile/non-portable configs remain GE1007; condition
null/non-object remains Graph-envelope GE1007.

The unreachable `lowerLevelRuntimeOnly` case and unsupported-condition runtime
graph were removed. Neither scheduler exposes a safe compile bypass:
TypeScript compile-and-run compiles the document; Python's scheduler recompiles
the captured spec in its compiled carrier. Unsupported conditions remain
compiler/validator vectors plus a zero-executor public-run gate.

Revision 2 now contains 6 pattern-lowering, 29 policy, 14 condition-registry,
2 JSON-envelope, 4 host-capture, 16 full compiler, and 11 reachable runtime
cases over 7 runtime graphs. It covers mathematical JSON `1.0`, boolean
rejection, missing/unknown fields, route/default/confidence/multicast bounds,
registered foreign conditions, cross-category ordering, cascades,
router-before-typed-port ordering, multicast activation/limit, descendant
pruning, active failure at a mixed join, inactive named output, defaults,
confidence, and forged output.

Every compiler case and runtime graph carries a literal expected hash using
lowercase-hex SHA-256 over UTF-8 bytes of the existing canonical Graph
serialization. Diagnostic projection now explicitly omits absent fields.

Revision 2 verification:

```text
strict duplicate-key JSON and corpus invariants: PASS
TypeScript core build: PASS
TypeScript runtime build: PASS
TypeScript literal graph hashes: 23/23 PASS
Python literal graph hashes: 23/23 PASS
TypeScript current runtime projections: 11/11 PASS
Python current runtime projections: 11/11 PASS
npm run check:docs: 286 links PASS
git diff --check on the two contract files: PASS
```

The compiler-negative graphs still compile under pre-integration compilers by
design; their future GE1401..GE1407 results are not claimed as current test
evidence. Revision 2 self-audit leaves HIGH 0 / MEDIUM 0 / LOW 0 against the
cited findings, pending independent re-review.

Gate wording clarification: the literal zero-call gate is TypeScript
`runGraph(document, ...)`; Python uses `try_compile_graph(document)` and proves
no `CompiledGraph` exists for `run_graph`, so prepared handlers remain at zero
calls. Revision 2 does not invent a Python document-taking combined API.

Independent revision-2 re-review found one remaining MEDIUM ordering-carrier
gap: the prose froze within-category declaration order, but the first revision
had neither multiple routers nor two diagnostics in one GE140x category. The
corpus now adds two literal multi-router graphs. One emits two GE1401 values in
non-lexical node declaration order; the other emits two GE1402 values in
non-lexical edge declaration order across distinct routers. Both freeze exact
paths and identities. Compiler graphs are now 18, literal compiler plus
runtime graph hashes are 25/25, and the earlier M3 carrier gap is closed.
