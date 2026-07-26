# CTRL-RELEASE-MAP-074 implementation review

- Reviewed at: `2026-07-26T20:39:45Z`
- Authority: `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- Leaf source: `codex_plans/delivery/release-checklist.md`
- Task source: `codex_logs/task-registry.json`
- Scope: mapping implementation only; no release leaf was changed from `Open`

## Result

The checklist defines exactly 178 release leaves. A leaf is counted only when a
Markdown table cell is exactly a backticked `REL-*` Task ID; prose references,
evidence references, ranges, and the post-audit overlay do not create leaves.
All 178 IDs are unique and now have exactly one primary live-task mapping.

The registry contained 107 unique tasks at review time. Every mapped task exists
with a live status, every registry dependency exists, and the registry dependency
graph is acyclic. Forty-two registry tasks are primary producers for one or more
release leaves; reuse of a producer across related leaves is intentional and does
not duplicate any release leaf.

Classification is fail-closed: 175 leaves are blocking. Only `REL-GR03`,
`REL-GR04`, and `REL-GR05` are non-blocking because the checklist explicitly
labels those growth outcomes as tracking/non-blocking. Mandatory growth conduct,
assets, decision policy, and community rows (`GR01`, `GR02`, `GR06`, `GR07`)
remain blocking.

## Semantic mapping review

Primary mappings follow the task that produces the final candidate-bound join,
not merely an early implementation ancestor. Examples:

- durability and lineage joins map to `D9-DURABLE-EXT-CONFORMANCE-034`;
- redaction byte/canary leaves map to `D9-REDACTION-CONFORMANCE-089`, while
  broad security and privacy joins map to `D16-SECURITY-062` and
  `D16-PRIVACY-079` respectively;
- full adapter joins map to `D13-ADAPTERS-049`, storage to
  `D15-STORAGE-WORKERS-054`, and operational CLI rows to `D9-OPS-CONTROL-085`;
- all platform/version matrix cells map to `D18-COMPAT-BENCH-064`;
- each pattern leaf maps to its named pattern task, while the shared bundle
  checker maps to `CTRL-PATTERNS-071`;
- external timing/report rows map to `D17-USABILITY-076` and are not inferred
  from internal tests;
- provenance, support, and final stable-versus-RC decisions map to
  `D20-PROVENANCE-066`, `D18-SUPPORT-READINESS-080`, and
  `CTRL-RELEASE-ROLLUP-086`.

## Verification

Commands executed:

```text
node scripts/check-release-task-map.mjs --checklist codex_plans/delivery/release-checklist.md --registry codex_logs/task-registry.json --map codex_plans/delivery/release-task-map.json
node scripts/check-release-task-map.mjs --json
node --test scripts/tests/release-task-map.test.mjs
node --check scripts/check-release-task-map.mjs
jq empty codex_plans/delivery/release-task-map.json
```

Observed result: `178/178`, 175 blocking, 3 non-blocking, 107 registry tasks,
acyclic dependency graph, and 18/18 tests passing. Negative tests reject duplicate
mapping, dangling mapped task, unknown leaf, missing coverage, absent or incorrect
blocking classification, registry cycle, dangling dependency, duplicate registry
task, retired mapped task, duplicate checklist leaf, checklist-count drift, source
redirection, policy redefinition, and unknown manifest fields.

## Still open

- This implementation does not make any release leaf Green. Candidate
  coordinates remain empty and checklist statuses remain Open.
- The registry task is still marked `planned`; the integration owner must record
  real start/completion evidence and update registry state under the registry
  write lease.
- The ownership plan still requires a distinct product-quality/QA review of the
  semantic assignments and negative fixtures.
- `CTRL-EVIDENCE-BACKFILL-075` and `CTRL-RELEASE-ROLLUP-086` remain open. Until
  those and every blocking producer are candidate-bound, stable v1 is no-go.
- The checker must be rerun whenever the checklist, task registry, mapping, or
  blocking policy changes; count or graph drift fails closed.
