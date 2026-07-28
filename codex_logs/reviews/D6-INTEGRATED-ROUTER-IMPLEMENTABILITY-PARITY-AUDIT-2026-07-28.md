# D6 integrated-router implementability and parity audit — 2026-07-28

## Disposition

The three-file compiler-contract candidate is **not implementable as written
without breaking existing published behavior or adding an unspecified runtime
bypass**.

Independent finding count: **HIGH 3 / MEDIUM 4 / LOW 1**.

Reviewed contract files only:

- `spec/integrated-router-semantics.md`
- `spec/conformance/integrated-router.case.json`
- `codex_logs/reviews/D6-INTEGRATED-ROUTER-COMPILER-CONTRACT-2026-07-28.md`

The audit used the current TypeScript/Python compiler diagnostic carriers, the
current router primitive and scheduler semantics, and the existing patterns
package as compatibility evidence. No source, spec, plan, daily log or task
registry file was changed by this audit.

## HIGH findings

### H1 — direct router-policy enforcement invalidates the published `routedBranches` constructor

The contract says a router's direct `node.config` must be an exact
`RouteSelectionPolicy` and requires `GE1401_INVALID_ROUTER_POLICY` otherwise.
The implementation handoff also requires all existing patterns tests to remain
green.

The current `@graph-engineering/patterns` `routedBranches` constructor does not
emit a route policy. It preserves the caller's classifier node unchanged while
deriving only the `RouteEquals` edges from `branches`. Its public options have
no policy field. The package's canonical test fixture calls
`node("classify", "router")`, whose config is `{}`, and asserts the constructed
graph is core-compiler valid.

Consequently a conforming `GE1401` pass rejects the standard, currently tested
output of the very constructor the contract says it reuses. The review log's
claim that both existing public shapes are retained is therefore false for the
policy half: only the condition carrier is emitted by patterns today.

Required resolution before compiler work:

1. version the patterns API so `routedBranches` owns or requires one exact
   policy and proves its `allowedRoutes` equal the branch-key set; or
2. explicitly declare the existing constructor deprecated/incompatible and
   update its contract/tests in the same release.

The compiler must not infer policy from metadata or conditions while still
claiming `node.config` is authoritative. Until one of those choices is frozen,
the requirement to retain the patterns suite and the required `GE1401`
behavior cannot both pass.

### H2 — global `GE1402` rejects another existing versioned condition family

The semantics define the exact three-field `RouteEquals` object as the only
supported conditional-edge document and assign every other `edge.condition`
`GE1402_UNSUPPORTED_EDGE_CONDITION`. That wording is graph-wide, not scoped to
router-owned edges.

The same published patterns package emits three other versioned condition
kinds for `loopUntilDry`: `LoopContinue`, `LoopDryVerdict`, and
`LoopVerdictAtBound`, under the same
`pattern-conditions/v1alpha1` API namespace. Its hard-bound test constructs 100
rounds and asserts `compileGraph(graph).valid === true`. The D6 handoff says to
retain all current patterns tests.

A graph-wide `GE1402` implementation makes every such graph compiler-invalid,
so the required regression suite cannot remain green. The fact that current
schedulers do not execute early-stop semantics does not erase the existing
declarative compiler contract.

Required resolution: define a condition-kind registry/ownership boundary.
The router pass may reject malformed `RouteEquals`, and may define what a
router source is allowed to emit, but it cannot reserve all `edge.condition`
documents without versioning or explicitly retiring the loop condition
family. Add a compiler case proving a non-router condition owned by another
registered family is not misclassified as `GE1402`.

### H3 — the post-compiler unsupported-condition runtime vector has no executable path

The corpus marks `unsupported-condition-defense-in-depth-settles-before-dispatch`
as `lowerLevelRuntimeOnly` and expects source/target node terminals
`UNSUPPORTED_EDGE_CONDITION` and `UPSTREAM_FAILED`. The prose says this remains
normative after the compiler begins rejecting the graph and that a lower-level
test deliberately bypasses compilation.

No such bypass exists in either runtime:

- TypeScript `runGraph`, `runGraphWithJournal`, and the durable graph compiler
  all call `compileGraph` before building scheduler state.
- Python `run_graph` accepts a `CompiledGraph`, but `AsyncScheduler._run`
  immediately snapshots its spec and calls `compile_graph` again. Durable start
  does the same fresh compilation.

Once `GE1402` is implemented, every real scheduler path returns or raises at
compilation and can no longer produce the fixture's two runtime node terminals.
The boolean `lowerLevelRuntimeOnly` is not an executable carrier and does not
identify a public or private API, a trusted compiled representation, or a safe
test hook. The review log's statement that all six runtime projections remain
mandatory after compiler integration is therefore unachievable in the stated
compiler-only handoff.

Required resolution: either freeze a safe internal precompiled-runtime test
surface in both languages and specify exactly how it avoids recompile without
becoming a public validation bypass, or move this vector to pre-integration
historical evidence/pure condition-validator tests. Also clarify the Python
phrase “public compile-and-run input”: Python currently has separate public
compile and compiled-run APIs, unlike TypeScript's document-taking `runGraph`.

## MEDIUM findings

### M1 — promised `GE1401`/`GE1402` ownership conflicts with the Graph envelope gates

The prose lists sparse arrays, non-data properties, non-portable policy values,
non-object conditions, and explicit condition `null` as router/condition
invalidity. The public compilers cannot route all of those values to the new
codes:

- TypeScript canonical capture and Python portable snapshot reject hostile
  accessors/sparse/non-portable containers before router analysis, producing
  the existing invalid-graph diagnostic.
- Both Graph envelope validators already require `edge.condition` to be an
  object and reject explicit null before the proposed condition pass.

The contract does state that schema-invalid graphs keep precedence, but it also
defines `GE1401` as any non-exact policy and `GE1402` as a non-object condition.
Those promises are observably inconsistent unless the diagnostic ownership
boundary is made explicit.

Resolution: state that capture/envelope failures are always `GE1007`, restrict
`GE1401`/`GE1402` to portable values admitted by Graph IR, and add literal
cases for null/non-object/exotic inputs at the correct earlier gate.

### M2 — the corpus is too small to prove the exact policy/condition validator

Only one invalid policy is present: a wrapper object. That does not test empty
or duplicate routes, unsafe route IDs, explicit-null optionals, unknown fields,
single-with-`maxMulticast`, multi-without/oversized/boolean `maxMulticast`, bad
default membership, malformed confidence, or escalation membership. Only two
unsupported condition shapes are present (wrong version and one extra field),
leaving missing keys, wrong kind/value types and unsafe route IDs unproved.

Because `core` cannot import `primitives`, both compilers will duplicate a
large validator. An implementation can pass all twelve cases while materially
disagreeing with the authoritative primitive. Add a table-driven policy and
condition matrix, including mathematical-integer `1.0` parity and boolean
rejection, before calling the shared corpus an exact contract.

### M3 — cross-pass diagnostic ordering and cascade behavior are under-specified by examples

The prose defines category ordering inside the router pass, but not an
unambiguous location relative to cycle/reachability/policy and typed-port
passes. The handoff says “post-structural” while separately saying to run after
schema/identity/endpoint gates; the current compilers return immediately for a
cycle and append typed-port diagnostics last.

No fixture contains multiple routers, multiple findings in one category,
`GE1401` plus `GE1402`, a later edge that duplicates both route and target, or
an independent typed-port diagnostic coexisting with router diagnostics.
Therefore both languages can satisfy every current expected projection but
emit different full diagnostic order/cascades on real graphs.

Resolution: freeze the pass boundary and add multi-diagnostic/cascade cases
for every stated suppression rule plus one independent-pass coexistence case.

### M4 — the runtime corpus does not cover several terminal claims it calls normative

The six vectors cover a single-selection mixed merge, no-match, default-empty,
confidence escalation, forged output, and the unreachable unsupported guard.
They do not cover:

- multi-route activation and `maxMulticast` behavior;
- an inactive-only descendant inheriting `ROUTE_NOT_SELECTED`;
- a mixed active/inactive join when the active predecessor fails;
- an inactive named graph output producing failed run/incomplete output with no
  invented node failure; or
- unknown-request selection through an enumerated default.

These are subtle areas that previously required runtime remediation. Leaving
them out of the literal cross-runtime corpus weakens the claimed parity gate.
Add exact vectors before using the corpus as release acceptance.

## LOW finding

### L1 — diagnostic projection omission semantics are implicit

`diagnosticProjection` lists `code`, `path`, `nodeIds`, and `edgeId`, while
node-only expected diagnostics omit `edgeId`. The corpus does not say whether a
projection drops absent fields or writes JSON null. This matters because
TypeScript naturally drops `undefined` during JSON serialization while Python
often serializes `None` as null.

Specify omit-if-absent semantics (recommended) and one projection helper shape
for both languages.

## Hash and current-semantics evidence

The current compilers still accept all twelve compiler cases, as the review log
correctly discloses. Independently running the live TypeScript and Python
compilers produced byte-identical graph hashes for all twelve cases. The two
currently valid positive cases hash to:

- `complete-single-with-omitted-default-is-valid`:
  `f3cf06d35deffa2a8be647c18f3104441685198e1a5a20fefc3e38f2fd911ab0`
- `complete-multicast-with-enumerated-default-is-valid`:
  `4dc7ec87b4a300f38a6f3ab8cca5e2cf52279a51f8b9bf421f325d0f3e229761`

The five runtime graph hashes also match cross-language in the current tree:

| Graph | SHA-256 |
|---|---|
| `diamond` | `6ac6bb97f48f403b85ebd57a116e9b94ba389afd9e3f4986895ef29cb14cae7c` |
| `no-match` | `7fc85186645408035a5414e2d994b9fcf7887734d7e9b6e4fdb5a5a6b219b510` |
| `default` | `03442f3155adb734ab1f9f4bc6e8bddd8fbcffda57b3dba4ac4def1eea970821` |
| `confidence` | `92b092299ddb99bd1f36c6254ed71def59ad4b571470b82041c28e41380dc140` |
| `unsupported-guard` | `664f25a52d58d91534ce89750944602e22a20b09c61b69aabc53dacc56390740` |

No inconsistent current hash was found. However, the corpus contains no
literal expected `canonicalGraph` or `graphHash` fields despite requiring their
parity. That is a carrier gap: tests may compare the two implementations, but
the JSON fixture alone cannot freeze either value. Add the expected hashes (and
either canonical bytes or a named canonicalization rule assertion) to avoid a
circular self-comparison.

## Required re-review gate

Do not begin the seven-code compiler implementation against this revision.
First resolve H1-H3 in the semantics and corpus, then add the M1-M4 matrices and
clarify L1. Re-review must prove:

1. the chosen router policy carrier is compatible with a versioned
   `routedBranches` output;
2. unrelated registered condition families are not globally captured by
   `GE1402`;
3. every runtime vector has a real, named execution surface after compiler
   enforcement;
4. the public diagnostic ownership/pass order is literal and cross-runtime;
5. expected hashes are frozen; and
6. existing core, patterns, primitives, scheduler and durable suites can all
   remain green under the resulting contract.
