# CTRL-RELEASE-MAP-074 semantic remediation

- Remediation date: `2026-07-26`
- Authority: `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- Inputs read in full: release checklist, full-plan gap audit, machine map,
  task DAG, all 107 registry tasks, checker, 34-test baseline suite, and both
  prior release-map reviews
- Scope: release-leaf semantic assignments, required task dependencies,
  evidence plans, DAG/checklist synchronization, and hostile regressions
- Release implication: **none**; all 178 release rows remain `Open`
- Candidate implication: **none**; no immutable candidate was selected or
  revalidated by this work

## Result

The prior map was structurally complete but still allowed several checklist
sentences to bind to a task that proved only one component. This remediation
changes 43 primary mappings to the earliest existing downstream join whose
dependency closure and own evidence contract can prove the full sentence.

The resulting structure still has exactly 178 unique mappings, 175 blocking
rows, exactly three non-blocking growth-outcome rows, 107 registry tasks, no
dangling dependency, and no cycle. The number of distinct blocking primary
producers decreases from 42 to 37 because related cross-cutting rows now share
real candidate joins. All 37 are inside the unchanged 94-task transitive
closure of `CTRL-RELEASE-ROLLUP-086`.

No checklist status changed. In particular, an expanded dependency or evidence
plan is future work, not proof that the work passed.

## Required findings and corrections

| Release row | Before | After | Why the previous producer was insufficient | New complete evidence contract |
|---|---|---|---|---|
| `REL-I04` | `D7-CYCLE-CONFORMANCE-027` | `CTRL-ACCEPTANCE-070` | D7 can prove explicit cycle/GraphPatch bounds, but cannot independently prove compiler implicit-cycle rejection and randomized retry exhaustion. | D2 compiler cycle rejection + D7 patch/fan-out bounds + D8 bounded retry/randomized no-unbounded-spawn + stable error evidence. |
| `REL-X09` | `D9-OPS-CONTROL-085` | `D18-COMPAT-BENCH-064` | D9 operations covers status/watch/inspect/logs/pause/resume/cancel/retry only, not both native CLIs or every public machine envelope/exit. | D3 TS/Python CLIs + D9 operations + D13 DX + full source command golden JSON/error/exit matrix. |
| `REL-PKG05` | `D14-NPM-DIST-078` | `D19-RC-065` | The canonical npm task cannot prove Python wheel/sdist console scripts. | Clean npm tarball and Python wheel/sdist installs; `graph` and `grapheng` resolution, candidate version, help, and deterministic-mock smoke. |
| `REL-PKG10` | `D9-OPS-CONTROL-085` | `D19-RC-065` | A source operational subset is neither the full CLI nor an installed-artifact test. | Every command from packed npm and wheel/sdist artifacts with schema-valid JSON, structured errors, and exit codes. |
| `REL-RC08` | `D9-APPROVAL-077` | `D18-SUPPORT-READINESS-080` | An approval contract cannot prove recovery execution or compensation and cannot establish truthful incident claims. | Durable event traces for idempotent replay, approval-required ambiguity, explicit compensation success/failure, plus docs/tabletop review that never claims irreversible rollback. |

## Additional same-pattern corrections

The remaining 173 rows were re-read against their exact checklist sentence,
mapped task tests/artifacts, and transitive dependency closure. The following
same-pattern defects were also corrected.

| Rows | Before | After | Rationale |
|---|---|---|---|
| `REL-V1-01` | D9 extended conformance | `CTRL-ACCEPTANCE-070` | Stable recovery also requires production-store races and the full `T19-T22`/`T30` candidate join. |
| `REL-I01` | D14 API freeze | `D18-COMPAT-BENCH-064` | An API freeze is not final TS/Python candidate conformance or proof that canonical `spec/` governs all surfaces. |
| `REL-I03`, `REL-I05`, `REL-I07` | API freeze, approval contract, or cycle join | `CTRL-ACCEPTANCE-070` | Each sentence crosses implementation lanes: plumbing-vs-judgment policy; at-least-once/idempotency/approval/compensation; or patch compiler/policy/permission/budget enforcement. |
| `REL-I08` | D12 red-team | `D16-SECURITY-062` | MCP mutations, completed adapters, Explorer/storage surfaces, and final independent disposition arrive after D12. |
| `REL-I10` | docs control | `CTRL-RELEASE-ROLLUP-086` | Package, site, release-note, demo, and channel copy do not all exist at docs-control time. |
| `REL-X07` | D8 runtime chaos | `D18-COMPAT-BENCH-064` | Provider/tool cancellation and exact accounting require adapters and the final source parity join. |
| `REL-T05` | D2 authoring/compiler | `CTRL-ACCEPTANCE-070` | The row includes runtime node-input/output rejection before unsafe persistence, not only graph parsing/compilation. |
| `REL-T15` | D7 cycle join | `CTRL-ACCEPTANCE-070` | Malicious patch coverage also requires D10 budgets and D12/D16 policy/permission enforcement. |
| `REL-T22` | approval contract | D9 extended durability conformance | Stale graph/run/revision approval must be rejected by persisted runtime behavior. |
| `REL-T26` | redaction conformance | `D18-SUPPORT-READINESS-080` | The checklist explicitly includes the later support-bundle sink; the support join consumes D9 and D16 evidence. |
| `REL-T27` | adapter join | `CTRL-ACCEPTANCE-070` | Complete propagation spans base runtime, provider, and tool boundaries. |
| `REL-T28` | D12 red-team | `D16-SECURITY-062` | Final prompt-injection evidence must attack all later public surfaces and receive independent disposition. |
| `REL-T29` | D9 operations | `D19-RC-065` | The checklist enumerates every CLI/MCP command and requires packed-artifact execution. |
| `REL-Q05`, `REL-MX-N01`-`N06`, `REL-MX-P01`-`P09` | D18 compatibility | `D19-RC-065` | Each Node/Python matrix cell explicitly requires clean packed/wheel installation and CLI smoke; D18 remains the source compatibility predecessor. |
| `REL-PKG09`, `REL-PKG12` | usability or API freeze | `D19-RC-065` | Installed no-credential Quickstart and upgrade compatibility must run against frozen package artifacts. |
| `REL-PKG13`, `REL-SC13` | npm-only or privacy-policy task | `D20-PROVENANCE-066` | Both npm/PyPI alias authority and telemetry/capture default-off from clean installed packages are release-artifact/provenance checks. |
| `REL-UX09`, `REL-DOC12` | usability or privacy contract | `CTRL-GROWTH-072` | Actual public reports/adopter/trace entries exist later and each needs authenticity, consent, redaction, retention, and withdrawal evidence. |
| `REL-DOC15` | docs control | `D19-RC-065` | The complete references must match the frozen installed candidate, upgrade path, CLI/MCP, adapters, stores, security, and support surface. |

Rows not listed above retained their prior primary assignment after the same
review. Keeping an early producer is intentional only where its own tests and
artifacts can close the exact row and candidate revalidation can rerun it.

## Dependency-bypass remediation

The semantic map is only sound if its selected join cannot run before a
required producer. These task-level edges and evidence contracts were added:

| Task | Added hard predecessor or evidence | Bypass closed |
|---|---|---|
| `D4-TRACE-SUBGRAPH-022` | D2 builders, both native runtime bases, durable namespace spec, and `D7-PIPELINE-CONFORMANCE-013`; exact subgraph/edge spec and fixture paths | A trace/subgraph task can no longer claim executable stream edges from a pre-pipeline scheduler or use a broad `spec/` directory as proof. |
| `D7-CYCLE-SPEC-024` | `D2-BUILDERS-YAML-020` | GraphPatch/cycle identity cannot freeze against the initial IR while bypassing the actual builder/revision/typed-port contract. |
| `D9-DURABLE-EXT-SPEC-031` | `D9-APPROVAL-077` | A durable spec that defines stale approvals and non-idempotent confirmation cannot precede the approval authority contract. |
| `D9-DURABLE-EXT-CONFORMANCE-034` | `D6-ROUTER-BARRIER-023` | Router replay without re-judgment cannot be claimed without scheduler-integrated route decision behavior. |
| `D10-BUDGET-CONFORMANCE-038` | `D7-CYCLE-CONFORMANCE-027`; exact all-dimension boundary matrix | Cost/model conformance cannot stand in for iteration/node/fan-out cycle limits unless it consumes the native cycle join. |
| `D16-PRIVACY-079` | `D9-REDACTION-CONFORMANCE-089` | A policy document or contract cannot prove enabled capture is actually redacted. |
| `D17-BETA-063` | `D13-DX-051` | A “complete Beta quickstart” cannot omit the promised doctor/score/badge remediation surface. |
| `D18-COMPAT-BENCH-064` | `D9-OPS-CONTROL-085`, `D13-DX-051`; exact source CLI parity reports | Final CLI parity cannot bypass operational or DX commands. |
| `D18-EDUCATION-ASSETS-083` | `D17-USABILITY-076`, `D18-COMPAT-BENCH-064` | Quickstart/cases/examples cannot be called authentic and conformant before user and parity evidence. |
| `CTRL-GROWTH-072` | explicit D16 security/privacy, D17 Beta/usability, and D18 education edges | Launch copy, galleries, and campaigns cannot advance from Explorer/DX scaffolds while real product, safety, education, and consent remain absent. |

The D19, D20, acceptance, security, support, growth, and final-roll-up tasks now
declare exact candidate report paths and test sentences for the broader rows
mapped to them. This avoids solving a bad mapping by merely redirecting it to a
task whose own completion contract is still too vague.

## Hostile regression coverage

The test suite now fixes both the semantic assignment and the required task
contract. It includes positive checks for the corrected cross-cutting mappings,
direct dependencies, exact report paths, and evidence text. Negative mutations
remove representative D2→D7, router→durable replay, operations→CLI parity,
Python installed executable, and compensation evidence; each mutation fails.

The generic checker remains intentionally responsible for structural rules:
canonical 178-leaf inventory, classification, live-task existence, evidence-plan
shape, acyclic registry graph, and roll-up ancestry. The semantic regression
table in the test suite is required because natural-language checklist scope
cannot be inferred safely from task titles.

## Status honesty and supersession boundary

- All checklist rows remain `Open`; candidate coordinates are empty.
- `CTRL-RELEASE-MAP-074` was already recorded `completed` before this
  remediation. Its prior 34-test references and file hashes do not bind these
  changes. This remediation does not refresh `completed_at`, does not add a new
  completion record, and does not authorize release. The integration owner must
  bind the remediated files, 36-test result, and a distinct review to an
  immutable commit using append-only superseding evidence.
- `D1-BRAND-001` remains historically `completed` while its expected test says
  authenticated registry publication rehearsal and its next action says
  publication is deferred. This is a status/evidence contradiction. It was not
  edited here because it is integration-owned; historical status must retain
  zero candidate weight until the integration owner corrects or revalidates it.
- No D2/D3 implementation status, heartbeat, completion evidence, or candidate
  binding was edited by this remediation.
- Historical task status, local test output, a healthy scanner, and this review
  all have zero release weight without the candidate revalidation overlay.

## External gates still unproved

The remediated graph preserves rather than hides external requirements:

- npm/PyPI namespace ownership and trusted-publisher authority;
- immutable Linux/macOS/Windows Node 20/22 and Python 3.11/3.12/3.13 runs;
- at least five real external usability reports and the 80%-within-300-seconds
  result with independent review;
- human privacy/data-owner approval and consent/withdrawal records;
- authentic case-study, adopter, and trace-gallery consent;
- independent security, release, and go/no-go reviewers;
- acknowledged launch/support roster and non-destructive yank/deprecate/
  forward-fix authority; and
- publishing, hosting, and channel authority.

If any is absent, the affected row remains `Open` or becomes `Blocked`; it is
never inferred Green. The 6,000+ star target remains a non-blocking organic
stretch outcome and cannot be guaranteed or manufactured.

## Verification to bind after remediation

Run from the shared repository root:

```text
node --check scripts/tests/release-task-map.test.mjs
node scripts/check-release-task-map.mjs --json
node --test scripts/tests/release-task-map.test.mjs
corepack pnpm check:release-map
corepack pnpm check:docs
python3 tools/progress-scanner/graph_progress.py --repo /home/nick/work/GraphEngineering scan
git diff --check
```

An independent reviewer must compare the immutable revision with this log and
confirm that no cross-cutting row again maps to a partial producer.

### Observed local result

The remediation snapshot passed all listed local controls:

- release map: `178/178`, 175 blocking, 3 non-blocking, 37 blocking
  producers in the 94-task roll-up closure, 107 tasks, acyclic;
- hostile/positive suite: `36/36` passed;
- documentation links: 201 checked;
- progress scan: 41 healthy, 66 waiting-dependency, 0 stale, 0 blocked,
  0 integration-risk, one D9 redaction heartbeat warning, and only 7/77
  evidence gates satisfied; and
- `git diff --check`: passed.

Mutable snapshot hashes (for independent comparison only, not candidate
evidence):

```text
4663ee7ce51fcddcf942646cb6b8972a18a646edee4edb6bef572def84a36b83  codex_plans/delivery/release-task-map.json
54d022c5f3e99a3d2d3f007522663b5b746816a4fb3a6ab4c7f4c0b69110647e  codex_plans/delivery/task-dependency-graph.md
6ba643d9fe42cdcd939124f393862a9444c4c578916ed35e2b0bebe6130db679  codex_plans/delivery/release-checklist.md
af5e1772dfe56352a832269d98aac5ec8fda81fec8a69411b7ae03850d95f310  codex_logs/task-registry.json
b5a16cb2be9494ada0e82cb7155c29c6fc2895328f79ef71bba45725a0cbfb2d  scripts/tests/release-task-map.test.mjs
```
