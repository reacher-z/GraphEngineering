# D6 integrated-router production final audit — 2026-07-28

## Verdict

**ACCEPTED for the bounded integrated-router production tranche described by
`spec/integrated-router-semantics.md`.**

Final severity count:

- HIGH: **0 open**
- MEDIUM: **0 open**
- LOW: **0 open**

This is an independent, post-remediation audit of the compiler, pattern
lowering, ordinary scheduler, and durable start/resume behavior in both
TypeScript and Python. It preserves the initial rejection findings rather than
rewriting the history as a first-pass success.

The acceptance is intentionally bounded by the canonical D6 contract. It does
not claim the `future` capabilities explicitly set to `false` in the corpus:
dedicated durable route-selection events, integrated barrier settlement,
quorum voting, deadline/late-arrival statistics, human-escalation events, or a
catch-all edge condition.

## Audited scope

### Canonical protocol

- `spec/integrated-router-semantics.md`
- `spec/conformance/integrated-router.case.json`

### TypeScript compiler and public surface

- `packages/core/src/compiler.ts`
- `packages/core/src/integrated-router.ts`
- `packages/core/src/index.ts`
- `packages/core/test/integrated-router.test.ts`
- `packages/core/README.md`

### Pattern lowering

- `packages/patterns/src/patterns.ts`
- `packages/patterns/src/types.ts`
- `packages/patterns/test/routed-branches.test.ts`
- `packages/patterns/test/integrated-router-corpus.test.ts`
- `packages/patterns/README.md`

### TypeScript ordinary and durable runtime

- `packages/runtime/src/router-runtime.ts`
- `packages/runtime/src/scheduler.ts`
- `packages/runtime/src/durable.ts`
- `packages/runtime/test/integrated-router-conformance.test.ts`
- `packages/runtime/test/scheduler.test.ts`
- `packages/runtime/test/durable.test.ts`
- `packages/runtime/README.md`

### Python compiler, ordinary runtime, and durable runtime

- `python/src/graph_engineering/compiler.py`
- `python/src/graph_engineering/integrated_router.py`
- `python/src/graph_engineering/scheduler.py`
- `python/src/graph_engineering/durable.py`
- `python/tests/test_integrated_router_compiler.py`
- `python/tests/test_integrated_router_runtime.py`
- `python/tests/test_scheduler.py`
- `python/tests/test_durable_scheduler.py`
- `python/README.md`

## Initial rejection inventory

The first production audit found **H3 / M1 / L1**. Each item below was a real
release blocker at the time it was reported.

### HIGH H1 — the pattern-lowering corpus contradicted Unicode normalization

The six `patternLoweringCases` declared `normalizedBranchKeys` in an order that
did not match the existing deterministic Unicode code-point ordering used by
`parseKeyedNodes`. Successful policies copied that wrong order, while the
mismatch vector was consequently reversed. The initial tests were primarily
hand-written examples and did not prove that all six normative cases were
actually consumed.

Impact: the canonical fixture could demand a graph that the real pattern
constructor could not emit, so cross-language conformance and literal graph
identity were not trustworthy.

### HIGH H2 — compiler-valid foreign conditions could enter execution

`LoopContinue`, `LoopDryVerdict`, and `LoopVerdictAtBound` are intentionally
registered and opaque to the D6 compiler. The ordinary and durable schedulers,
however, execute only `RouteEquals`. Before remediation, the runtime defense
was local to the source-node path rather than a whole-graph capability
preflight. Independent work or durable-history access could therefore precede
the unsupported-condition failure.

Impact: a compiler-valid graph containing a condition owned by another feature
could begin execution or durable protocol work before the runtime admitted it
could not execute the graph.

### HIGH H3 — GE1404/GE1405/GE1406 were not globally edge ordered

The relational diagnostic implementation accumulated route errors through
per-router traversal. On a graph with interleaved edges from multiple routers,
TypeScript could project category diagnostics in router order while Python and
the contract required global edge declaration order.

Impact: portable diagnostic arrays and their exact paths could diverge between
runtimes even though each single-router test passed.

### MEDIUM M1 — Python did not consume the 11 normative runtime cases

TypeScript iterated `runtimeCases` directly. Python had strong hand-written
router tests and consumed the runtime graph hashes, but it did not execute all
11 literal runtime cases from the shared corpus through the public runtime
surface.

Impact: analogous tests could drift from the normative decisions, terminals,
attempts, outputs, failure codes, or executor-call counts without failing the
Python suite.

### LOW L1 — public TypeScript validator result types were incomplete

The root core API exposed the new validation functions without exposing the
full discriminated result types needed to use those functions without private
module imports or type reconstruction.

Impact: runtime behavior was correct, but the new public validation API was not
complete for TypeScript consumers.

## Remediation and closure evidence

### H1 closed — one canonical branch order and literal six-case execution

All six pattern cases now declare the real normalized order
`["audit", "quick"]`. Successful synthesized, supplied, and preconfigured
policies use that same ordered route list. The mismatch case now supplies the
true reverse order. Conflict and invalid-policy cases use the same two-branch
inventory, preventing a one-key case from evading the normalization contract.

`packages/patterns/test/integrated-router-corpus.test.ts` now:

- freezes the exact six-case name inventory;
- asserts every case's literal normalized key list;
- executes every successful case with normalized and reversed input
  permutations;
- proves graph equality and canonical-hash equality across permutations;
- recompiles both outputs successfully;
- executes every error case under both permutations; and
- proves the error occurs before any graph is returned at the exact expected
  path.

Independent result: the complete patterns suite passed **106/106**.

### H2 closed — whole-graph capability preflight in four execution paths

Both runtimes now scan the captured/compiled graph before dispatch, group
unsupported conditions by source node, preserve source-node declaration order,
and preserve edge declaration order within each source's message.

The preflight is applied to:

1. TypeScript ordinary execution;
2. TypeScript durable start and resume;
3. Python ordinary execution; and
4. Python durable start and resume.

Independent hostile probes used a compiler-valid graph with two source nodes
declared in a deliberately non-lexical order and three interleaved registered
loop conditions. For both languages the probes proved:

- compiler validity before the runtime capability check;
- failures ordered by source-node declaration;
- per-source messages ordered by edge declaration;
- an empty node-terminal collection;
- zero scheduled/completed nodes;
- zero attempts;
- zero handler/executor calls;
- zero durable-history reads;
- zero durable-history appends; and
- identical failure ordering on durable start and resume.

The public runtime tests additionally bind the stable
`UNSUPPORTED_EDGE_CONDITION` structured failure at attempt zero.

### H3 closed — category collection follows the global edge stream

Both validators now build the candidate stream in graph edge declaration order
and append GE1404, GE1405, and GE1406 to category-specific arrays while walking
that single stream. Router-local `seenRoutes`, `seenTargets`, and
`acceptedRoutes` sets retain relational correctness without controlling output
order.

Independent TypeScript and Python probes created separate interleaved,
multi-router graphs for each category and required these exact projections:

- GE1404: `z-bad`, then `a-bad`;
- GE1405: `z-dup`, then `a-dup`; and
- GE1406: `z-dup`, then `a-dup`.

Both languages returned the exact edge IDs, source/target `nodeIds`, and
declaration-index-derived paths. The focused compiler suites also cover the
full 29 policy cases, 14 condition cases, 18 compiler cases, literal hashes,
envelope ownership, hostile captured values, projection omission, local
suppression, and cross-router category order.

Independent result: the complete core suite passed **238/238**.

### M1 closed — Python consumes all 11 runtime cases literally

`python/tests/test_integrated_router_runtime.py` loads the canonical JSON
directly and freezes:

- the exact 11-case name inventory;
- the exact seven referenced runtime graphs;
- every case's closed top-level and expectation field sets;
- public `try_compile_graph` followed by public `run_graph` execution;
- status and total attempts;
- output or explicit output absence;
- graph failure-code order;
- exact per-executor call counts; and
- exact node terminal projections, including optional output and structured
  failure fields.

Independent results:

- new corpus file: **12/12**;
- compiler + new corpus + ordinary + durable focused set: **123/123**.

### L1 closed — root API and generated declarations are complete

`@graph-engineering/core` now exports both validators and all associated public
types from its package root:

- `PolicyValidation`;
- `ConditionValidation`;
- `InvalidRouterValue`;
- `ValidRouterPolicy`;
- `ValidRegisteredCondition`; and
- `RouteSelectionPolicySnapshot`.

After a clean core/runtime build, the audit confirmed those exports in
`packages/core/dist/index.d.ts`, confirmed the detailed declarations in
`integrated-router.d.ts`, and confirmed that the patterns declaration exposes
`routePolicy?: RouteSelectionPolicySnapshot`.

### Follow-up LOW found during final audit — stale public README claims closed

The final read-through found that both runtime READMEs still described compiler
exhaustiveness/default diagnostics as future work after GE1401 through GE1407
had landed. Both documents now state the implemented compiler checks, explain
that registered loop conditions remain compiler-valid, and document the
ordinary/durable whole-graph fail-closed preflight. The future-work lists are
limited to capabilities that remain genuinely absent.

Independent documentation result: **286 local Markdown links checked**.

## Normative corpus coverage

The final audit found executable evidence for every normative behavior group:

- 6 pattern-lowering cases;
- 29 policy-validation cases;
- 14 condition-registry validation cases;
- 2 Graph-envelope condition gates;
- 4 host-constructed envelope attacks;
- 18 compiler cases with exact diagnostic projections and literal hashes;
- 7 runtime graph hashes and the literal hash contract;
- both language-specific invalid-execution gate declarations;
- 11 runtime cases on the real public execution surfaces; and
- diagnostic omit-if-absent and order preservation.

The repository fixture validator accepted **73 JSON fixtures / 35 case
manifests** and the other retained protocol fixtures in the same run.

## Final verification ledger

### Main integration gates

- TypeScript core: **238/238 passed**
- TypeScript patterns: **106/106 passed**
- TypeScript runtime: **257/257 passed**
- Python complete gate: **1835 passed with 2 retained subtests**
- project-standard Ruff: passed
- project-standard formatting gate: passed for the owned D6 files
- project-standard MyPy gate: **54 configured targets passed**
- fixture validation: passed
- documentation links: **286 passed**
- scoped `git diff --check`: passed

### Independent audit gates and probes

- core integrated/full package gate: **238/238 passed**
- patterns full package gate: **106/106 passed**
- runtime integrated/scheduler/durable package gate: **257/257 passed**
- Python D6 compiler/scheduler/durable focused gate before the new corpus:
  **111/111 passed**
- Python new literal runtime corpus: **12/12 passed**
- Python combined D6 focused gate after remediation: **123/123 passed**
- independent Python full invocation: **1818/1818 passed**
- core, patterns, and runtime TypeScript typecheck/lint: passed
- Python Ruff check for D6 source/tests: passed
- Python format check for the eight D6 source/test files: **8/8 already
  formatted**
- Python source MyPy: **52 source files, no issues**
- fixture validator: passed
- documentation checker: **286 links passed**
- scoped diff check: passed
- multi-source foreign-condition preflight probes: passed in both languages
- multi-router GE1404/GE1405/GE1406 order probes: passed in both languages
- generated public declaration inspection: passed

One deliberately broader, nonstandard audit command asked MyPy to type-check
entire legacy test modules explicitly and surfaced pre-existing test-annotation
errors. It is not reported as green and was not used as acceptance evidence.
The project-standard MyPy gate and a direct `python/src` MyPy run were green.
Likewise, the repository-wide formatter reports unrelated pre-existing files;
the exact eight owned D6 Python files were independently format-clean.

## Final severity reconciliation

| Severity | Initial | Added during final pass | Closed | Open |
|---|---:|---:|---:|---:|
| HIGH | 3 | 0 | 3 | **0** |
| MEDIUM | 1 | 0 | 1 | **0** |
| LOW | 1 | 1 documentation correction | 2 | **0** |

## Acceptance statement

The D6 integrated-router production tranche now has a single literal protocol
source, deterministic and cross-language compiler diagnostics, atomic pattern
lowering, fail-closed runtime capability boundaries, exact public runtime
corpus execution, durable start/resume protection, complete TypeScript public
types, and truthful public documentation.

No HIGH, MEDIUM, or LOW finding remains open in the audited scope. This audit
therefore authorizes the integration agent to stage the exact D6-owned files,
append the master-plan/daily evidence, and create the requested milestone
commit. It does not authorize claims for the explicitly excluded future D6
barrier/quorum/deadline/event surfaces.
