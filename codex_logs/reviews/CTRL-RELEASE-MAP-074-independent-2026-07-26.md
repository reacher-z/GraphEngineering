# CTRL-RELEASE-MAP-074 independent hostile review

- Review duty: independent `PQG` / hostile release-control review
- Reviewed at: `2026-07-26T20:55:39Z`
- Base revision: `582b78ba9c0db9eab698b18c9cebf12bf547627a`
- Decision: **accepted for integration after corrections**
- Release implication: **none**; this review changes no checklist row from
  `Open` and does not authorize stable publication

## Scope and method

The reviewer read the complete master plan, release checklist, task dependency
graph, ownership map, all 107 registry tasks, all 178 mapping records, the
checker, and its test suite. The leaf inventory was independently rebuilt from
the fourteen canonical release tables rather than trusted from the original
implementation summary.

The audit attacked these failure modes:

- missing, duplicate, swapped, synthetic, or wrong-column `REL-*` leaves;
- malformed Markdown rows, hidden extra cells, code-span pipes, empty evidence
  slots, invalid statuses, and checklist count drift;
- missing/retired mapped tasks and empty or duplicate task evidence plans;
- mandatory rows downgraded to non-blocking and tracking rows reclassified;
- dangling, duplicate, and cyclic registry dependencies;
- blocking producers absent from the final release roll-up dependency closure;
- mappings to downstream tasks and mappings whose task scope proves only part
  of a cross-cutting release condition; and
- absence of the checker from the normal repository/CI gate.

## Independent inventory

The canonical checklist inventory is:

| Family | Leaves |
|---|---:|
| Stable-v1 joins | 8 |
| Invariants | 10 |
| Cross-language | 10 |
| Mandatory scenarios | 33 |
| Quantitative thresholds | 11 |
| OS/runtime matrix | 17 |
| Packages | 13 |
| Supply chain/security | 14 |
| External usability | 10 |
| Pattern bundle plus ten patterns | 11 |
| Documentation/assets | 16 |
| Growth/community | 7 |
| Support | 8 |
| RC fallback | 10 |
| **Total** | **178** |

Current validated result:

- 178 unique checklist leaves and 178 unique mappings;
- 175 blocking leaves;
- exactly three non-blocking outcome rows: `REL-GR03`, `REL-GR04`, and
  `REL-GR05`;
- 107 unique live registry tasks, with no dangling or cyclic dependency;
- 42 distinct blocking producer tasks;
- all 42 blocking producers are the roll-up task itself or are contained in the
  94-task transitive dependency closure of `CTRL-RELEASE-ROLLUP-086`; and
- every mapped task declares at least one non-empty expected artifact and one
  non-empty expected test.

## Findings and disposition

### P0-01 — blocking producers could bypass the release roll-up — closed

The original graph allowed `CTRL-RELEASE-ROLLUP-086` to run without three
blocking mapped producers in its transitive predecessor set:
`D14-NPM-DIST-078`, `D8-CHAOS-OPS-030`, and `D9-OPS-CONTROL-085`. That could
have allowed mandatory npm-distribution and operational-control leaves to remain
unfinished while the final roll-up advanced.

Disposition:

- `D19-RC-065` now depends on `D14-NPM-DIST-078`;
- `CTRL-ACCEPTANCE-070` now depends on `D8-CHAOS-OPS-030`, which in turn depends
  on `D9-OPS-CONTROL-085`;
- the dependency graph document records the same joins; and
- the checker now rejects every blocking mapped producer that is not a
  transitive roll-up predecessor. A downstream-task mapping is also rejected.

### P1-01 — arbitrary Markdown cells could impersonate leaves — closed

The initial extractor counted any table cell exactly matching a backticked
`REL-*` string. A missing canonical row could therefore be replaced by a
synthetic-table cell, and two Task IDs could be swapped while preserving the
set and total.

Disposition: the checker now validates the exact fourteen-table inventory,
six-column shape, table separators, gate family membership, gate-to-Task-ID
binding (`PB`/`Pxx` included), unique gates, allowed status, non-empty evidence,
and orphan exact release cells. Pipes in code spans or escaped text are handled
without creating fake columns.

### P1-02 — blocking policy could drift from checklist wording — closed

The allowlist was hard-coded but the checklist requirement text was not checked.
A row could therefore claim non-blocking behavior while its mapping remained
blocking, or vice versa.

Disposition: both the manifest and checklist text must agree that only
`REL-GR03`, `REL-GR04`, and `REL-GR05` are non-blocking. `GR01`, `GR02`, `GR06`,
and `GR07` remain mandatory.

### P1-03 — existing tasks with empty evidence plans passed — closed

Existence and status alone were accepted. A mapped task with empty
`expected_artifacts` or `expected_tests` could pass structural validation.

Disposition: both arrays must exist, be non-empty, contain non-empty strings,
and contain no duplicate entries for every mapped task.

### P1-04 — several cross-cutting leaves were mapped to partial producers — closed

The semantic read found mappings whose original task could prove only one part
of the checklist condition. Corrections include:

- full gate/asset joins `REL-V1-06`, `REL-V1-07`, and `REL-RC05` now map to the
  final release roll-up;
- structured terminal/failure joins `REL-I02` and `REL-X06`, combined
  adapter-plus-storage joins `REL-X10` and `REL-Q03`, and the complete failure
  policy row `REL-T11` map to `CTRL-ACCEPTANCE-070`;
- all hard budget dimensions in `REL-T18` map to
  `D10-BUDGET-CONFORMANCE-038`;
- the 100-run randomized-failure threshold `REL-Q04` maps to
  `D18-COMPAT-BENCH-064`; and
- repository/package/history secret scanning and broad fuzz/prompt-injection
  rows `REL-SC07` and `REL-SC12` map to `D16-SECURITY-062`, which consumes the
  narrower redaction join instead of replacing it.

A regression test freezes these cross-cutting assignments.

### P2-01 — checker was not a normal CI gate — closed

The root now exposes `pnpm check:release-map`, and `.github/workflows/ci.yml`
executes it. This review did not modify those integration-owned files.

## Verification evidence

Commands executed from `/home/nick/work/GraphEngineering`:

```text
node --check scripts/check-release-task-map.mjs
node --check scripts/tests/release-task-map.test.mjs
node scripts/check-release-task-map.mjs --json
node --test scripts/tests/release-task-map.test.mjs
corepack pnpm check:release-map
```

Observed final result:

```text
178/178 leaves
175 blocking, 3 non-blocking
42 blocking producers in a 94-task roll-up closure
107 registry tasks
dependency graph acyclic
34/34 hostile and positive tests passed
```

The negative suite now rejects duplicate/missing/unknown mappings, missing or
incorrect blocking flags, unauthorized checklist classification wording,
registry cycles/dangling/duplicate dependencies, non-live tasks, blocking tasks
outside the roll-up, downstream mappings, duplicate/synthetic/swapped leaves,
empty evidence cells, invalid statuses, malformed/extra table columns, gate
inventory drift, empty/duplicate task evidence plans, source redirection,
policy redefinition, and unknown manifest fields.

Reviewed working-tree hashes:

```text
1bae12a1b44fd77eccb266aa656c6e68a916a1865ea7a90b53238e08dc39e009  codex_plans/delivery/release-checklist.md
8eb701fb9b2b089170e56230659f582cc884da094804ef159ccc1d8c8640d9ff  codex_plans/delivery/release-task-map.json
01c903db3b4ff29832a762701b86131218887ba5f7ee52e9b1875bcaeac494d9  codex_logs/task-registry.json
5bc5bb6cd4e01b258cba10b28b5d2bc7fba4a37d9cf017c29e75f34dba8b5ccb  codex_plans/delivery/task-dependency-graph.md
c2078e04a4793e39b30b9550c93043fdac1c30143ea51d4338bb4c06c411bcf7  scripts/check-release-task-map.mjs
7b6056f414c39dcbbbe4a2cd63425370b5481dbba94e514f3d386899be403a38  scripts/tests/release-task-map.test.mjs
3ed9162e68e57d2c2d07ec9824a94099604a01ae6419145e35b5adf35776f52a  package.json
071f5bede11cc8cf9a8f3f06e4c8e6bb15ae1d33f254134d41b9f35b6b11f7ba  .github/workflows/ci.yml
```

## Acceptance boundary

No P0 or P1 finding remains open for the mapping control at the reviewed
working-tree state. `CTRL-RELEASE-MAP-074` is accepted for integration, subject
to the integration owner binding these files and this review to an immutable
commit and recording completion evidence.

This is structural release-control evidence only. Candidate coordinates are
still empty, the 178 release rows remain `Open`, and historical completed tasks
still have zero candidate weight until `CTRL-EVIDENCE-BACKFILL-075` revalidates
them. Stable v1 remains fail-closed behind every blocking leaf and
`CTRL-RELEASE-ROLLUP-086`.
