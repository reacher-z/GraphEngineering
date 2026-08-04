# The fourteen-step Graph Engineering course

An executable course: every module ships against the contract in the
[master plan](../../codex_plans/Graph-Engineering-21-Day-Master-Plan.md)
(§22.1) — twelve artifacts per module, including a smallest working graph in
JSON *and* YAML, TypeScript *and* Python runners, a deterministic fixture, a
committed **wrong** implementation with the test that exposes it, and
machine-checkable exercises. A module is listed as complete only when all
twelve artifacts exist and their runners exit 0.

## Status

**One module of fourteen is complete.** This table is the honest state as of
v0.2.0-alpha.2, not a roadmap. "Blocked" names the missing runtime capability
(from [`CHANGELOG.md`](../../CHANGELOG.md), "What is not in this release");
"not started" with no blocker means the runtime could support the module
today and only the course material is missing.

| # | Module | Status |
| --- | --- | --- |
| 1 | **Nodes and real data edges** — distinguish dependency from typing order and draw values crossing edges. | Not started. Runnable today on the ordinary schedulers. |
| 2 | **Linear chain as a degenerate graph** — remove fake edges and compare critical path. | Not started. Runnable today. |
| 3 | **Closed node contracts** — structured input/output, validation, failures, capability, and budget. | Not started. Partially blocked: capability and budget declarations are refused pre-dispatch or ignored — nothing observes what a node actually does at execution time. |
| 4 | **Edges as deterministic plumbing** — transforms, dedupe, artifacts, streams, and why not every combine needs a model. | Not started. Partially blocked: `stream` and `artifact-ref` edge modes and `map` are refused pre-dispatch (`edge-mode:stream`, `edge-mode:artifact-ref`, `edge-map`); only `value` edges execute. |
| 5 | **Fan-out** — bounded native parallelism, partial failure, cancellation, and resource accounting. | Not started. Bounded parallelism and partial failure are runnable today; resource accounting is blocked — `resources` is refused pre-dispatch (`resource-admission`). |
| 6 | **Fan-in and barriers** — true cross-item dependency, quorum/deadline, missing statistics, and false-barrier detection. | Not started. Blocked: integrated barriers execute only in the TypeScript *ordinary* scheduler. The TypeScript durable scheduler refuses them (it does not journal `BarrierSatisfied`), and **Python executes them nowhere** — any non-trivial barrier config is refused under `node-config:barrier`. A cross-language module cannot be honest yet. |
| 7 | **Diamond topology** — split, independent work, deterministic reduce, and judgment synthesis. | **Complete.** [Module document](./module-07-diamond.md) · [executable artifacts](../../examples/course/module-07/). |
| 8 | **Runtime routing** — exhaustive conditional edges, durable decision, replay, and confidence escalation. | Not started. Router nodes with exhaustive `RouteEquals` conditions execute today; confidence escalation has no runtime. |
| 9 | **Verification** — reflection, adversarial/diverse review, votes, quorum, citations, judges, and unknown. | Not started. Blocked: no verification, judge, or citation runtime exists — `verification-semantics` is a frozen contract with `implementationClaim: false` in both languages. |
| 10 | **Isolation** — worktrees, processes, containers, capabilities, approvals, merge gates, and at-least-once effects. | Not started. Blocked: no isolation runtime at all — no isolation provider, no capability engine, no merge gate. The `isolation` IR field is refused pre-dispatch (`isolation-provider`), and a node executor has the ambient authority of the host process. |
| 11 | **Convergent cycles** — global seen, dry rounds, hard limits, GraphPatch, recovery, and no infinite rediscovery. | Not started. Partially blocked: the cycle controller, GraphPatch, and checkpoint recovery exist, but the `loopUntilDry` blueprint runs on no scheduler — it fails closed with `UNSUPPORTED_EDGE_CONDITION` because its loop conditions are not `RouteEquals` on a router. |
| 12 | **Model tiering and budgets** — portable usage/cost, reservations, router, fallback, and privacy. | Not started. Blocked: no budget or cost runtime — `budget-semantics` is an unaccepted contract candidate, `maxCostUsd` is refused pre-dispatch (`cost-budget`), declared budgets are documentation, and no provider client or model router exists to tier across. |
| 13 | **Topology as latency/cost** — pipeline versus barrier, critical path, backpressure, worker utilization, and measurement. | Not started. Event-order traces over the durable journal are measurable today; there is no metrics or tracing backend, so wall-clock measurement is out of scope. |
| 14 | **Safe self-routing** — planning a graph at runtime while preserving compiler, policy, budget, authority, verifier, and human gates. | Not started. Blocked: dynamic graph planning is refused pre-dispatch (`maxDynamicNodes` → `dynamic-graph-patch`), and the budget, verifier, and approval gates it must preserve have no runtime (see modules 9, 10, 12). |

The master plan (§22.2) also names an optional fifteenth chapter, **When not
to use a graph**. Not started.

## Running the complete module

```bash
node examples/course/module-07/run.mjs                                  # exit 0
uv run --project python python examples/course/module-07/run.py         # exit 0
node examples/course/module-07/wrong.test.mjs                           # exit 0 (the bug is detected)
uv run --project python pytest examples/course/module-07/wrong_test.py  # exit 0
node examples/course/module-07/check-exercises.mjs                      # exit 0 (solutions verified)
```

Build prerequisite, if `packages/*/dist` is missing:
`corepack pnpm --filter @graph-engineering/core build && corepack pnpm --filter @graph-engineering/runtime build`.

## The module contract (§22.1)

Every module must ship: (1) learning objective and prerequisites, (2) one
conceptual diagram, (3) one smallest working graph, (4) YAML/JSON plus
TypeScript and Python source, (5) a deterministic fixture with expected
output, (6) one common incorrect implementation, (7) one failing test that
exposes the error, (8) the repaired implementation, (9) performance, cost,
security, and durability implications, (10) CLI/SDK launch instructions,
(11) exercises with machine-checkable solutions, and (12) version and
known-limit references. [Module 7](./module-07-diamond.md) maps each artifact
to its file.
