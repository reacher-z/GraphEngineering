# Full 21-day plan gap audit — 2026-07-26

- Audit snapshot: `2026-07-26T21:28:09Z`
- Repository: `/home/nick/work/GraphEngineering`
- Branch and immutable base: `feat/pipeline-runtime` at
  `582b78ba9c0db9eab698b18c9cebf12bf547627a`
- Working tree at snapshot: dirty, 85 modified or untracked paths
- Decision: **the 21-day plan is not complete; stable v1 and a complete RC are
  not currently authorized**
- Release-leaf state: all 178 canonical checklist leaves remain `Open`
- Candidate state: no candidate exists in
  `codex_logs/release-evidence/task-revalidation.json`; historical task status
  therefore contributes zero candidate release weight

## 1. Audit scope and evidence rule

This audit completely read the following canonical sources rather than relying
on scanner summaries or earlier completion labels:

1. `codex_plans/Graph-Engineering-21-Day-Master-Plan.md` — 365 lines;
2. `codex_plans/delivery/master-plan-coverage-matrix.md` — 191 lines;
3. `codex_plans/delivery/task-dependency-graph.md` — 459 lines;
4. `codex_plans/delivery/release-checklist.md` — 372 lines;
5. `codex_plans/delivery/release-task-map.json` — 908 lines and all 178
   mappings;
6. `codex_plans/delivery/agent-ownership-map.md` — 410 lines; and
7. `codex_logs/task-registry.json` — 1,914 lines and all 107 task records.

The current Git graph, working-tree status, exported TS/Python APIs, package
manifests, CI, specs, fixtures, source files, tests, docs, examples, existing
reviews, and release-evidence directory were also inspected. Evidence was
classified using the plan's strict rule: source presence, a historical
`completed` value, an author test summary, or scanner `healthy` is not a
candidate-bound release result.

At the snapshot the registry contains:

| Registry state | Count | Release interpretation |
|---|---:|---|
| `completed` | 37 | Useful historical/local evidence, but zero candidate weight until revalidated |
| `in_progress` | 6 | Partial work only |
| `planned` | 64 | No accepted implementation evidence |
| **Total** | **107** | Structurally unique and acyclic |

The scanner reported 42 healthy, 65 waiting, no stale/blocker/risk warnings,
and 7 of 77 evidence gates satisfied. That is a liveness/migration result only.
It conflicts with neither the 70 unfinished tasks nor the 178 open release
leaves. In particular, a task may be scanner-healthy while its independent
review says implementation acceptance is blocked.

## 2. Capabilities genuinely supported by current code and tests

The following capabilities have real code and focused test evidence. The
exclusions in the final column are part of the finding and must stay visible.

| Capability | Current evidence | Exact boundary |
|---|---|---|
| Base Graph IR and DAG compiler | Canonical `spec/graph.schema.json`, shared positive/negative fixtures, native TS/Python models and compilers, canonical bytes/hashes, reachability/endpoints/cycle checks | Does not yet prove every future node kind, patch, budget, capability, reducer, subgraph, or complete-candidate diagnostic |
| Native deterministic DAG schedulers | TS and Python ready queues, bounded concurrency, diamond execution, retries, timeouts, cancellation, input/output port binding, structured terminal failures | No executable conditional router/barrier wait, subgraph, human gate, dynamic patch, cycle, distributed worker, or full 1,000-node release report |
| Pure barrier and route evaluators | Native all/minimum/percentage settled barriers and single/multicast/confidence route selection with shared fixtures | Pure evaluators only; no scheduler-integrated deadline/quorum waiting or durable decision replay |
| Local persistence primitives | TS memory/JSONL event stores, file checkpoints; Python equivalents; CAS, corruption, path and atomic-write tests | No ArtifactStore, SQLite default, PostgreSQL, S3, distributed LockManager/lease implementation, or complete shared storage suite |
| Immutable-local-DAG durable start/resume | Feature commit `854b2e3`; event-sourced commit-before-release, interrupted-attempt handling, activity keys, terminal idempotence and bidirectional history tests | Feature branch, not the published alpha tag; no truthful sink protection, leases, replay/fork, approval, production stores, or dual-orchestrator release proof |
| Standalone bounded pipeline | Feature commit `3df201d`; TS/Python lazy bounded stages, backpressure, ordering, stop/drop/dead-letter/retry, cancellation/cleanup, eight shared cases | Standalone API only; Graph IR stream-edge lowering and durable per-item recovery remain open |
| Existing TS CLI and read-only MCP | TS `init`, `validate`, `compile`, `plan`, `doctor`, Mermaid/DOT visualization; read-only validation/planning MCP and package smokes | Not the complete command matrix; no run/operations/replay/cost/score/worktree/artifact/plugin runtime surface or policy-gated MCP mutation |
| Static patterns and provider-free examples | Four TS constructors (`diamond`, routed branches, verified fanout, bounded static loop expansion) and two deterministic quickstart/showcase paths | Constructors are not ten complete cross-language pattern bundles; declarative verifier/router/loop shapes are not runtime behavior |
| D2 authoring and Python CLI working-tree slice | Independent review accepted strict JSON/bounded YAML, TS/Python builders, exact typed ports, revision-1 component identity, finite-binary64 parity, Python CLI and packed artifact smokes; reported 1,012 Python tests, 166 core tests and 147 CLI tests | Still uncommitted on base `582b78b`; no immutable candidate/revalidation record; GraphPatch revision 2+, general schema assignability and runtime edge execution excluded |
| Delivery controls | Active 30-minute systemd scanner; release-map checker; 178/178 mapping; hostile negative suite; docs link checker | Release-map implementation is still in the dirty tree; mapping completeness does not make any leaf Green |

Remote Git evidence shows `v0.1.0-alpha.1` at `f5d7eac`, while remote `main`
is `d242b65`. Durable recovery and pipeline commits are later feature-branch
work and must not be described as included in that published tag.

## 3. Completed-task evidence audit

The 37 registry-completed tasks fall into three evidence classes:

1. The first 30 alpha/foundation tasks, `D1-SPEC-001` through
   `D6-DURABLE-CONFORMANCE-011`, were assigned before the explicit evidence
   cutoff. Their code may be reused, but none has candidate weight without the
   `CTRL-EVIDENCE-BACKFILL-075` overlay.
2. `D7-PIPELINE-SPEC-012`, `D7-TS-PIPELINE-012`,
   `D7-PY-PIPELINE-012`, and `D7-PIPELINE-CONFORMANCE-013` have explicit test
   evidence and bind to commit `3df201d`; they still need candidate revalidation
   for a future RC/v1.
3. `CTRL-PLAN-COVERAGE-001` and `CTRL-EVIDENCE-002` have structural control
   evidence. `CTRL-RELEASE-MAP-074` has strong independent working-tree review,
   but is prematurely marked completed because the mapped files/checker/CI
   edits are not yet bound to an immutable commit.

One earlier completion label is materially broader than its evidence:
`D1-BRAND-001` is titled “Restore GitHub remote and secure package identities”
and expects an authenticated publication rehearsal, but its own next action
says registry publication remains deferred. The remote portion is complete;
trusted npm/PyPI identity and rehearsal are not. That task should either be
narrowed to the source-repository result or reopened/superseded by the explicit
distribution/provenance tasks.

## 4. Every unfinished task and its re-entry condition

### 4.1 In-progress tasks — 6

| Task | Actual state at audit | Required re-entry/closure |
|---|---|---|
| `D2-BUILDERS-YAML-020` | Implementation and independent hostile review are locally accepted | Commit the exact reviewed tree; rerun/bind full gates, package artifacts, shared conformance and review to that SHA |
| `D3-PY-CLI-021` | Native Python CLI and both console entries exist and were reviewed with D2 | Cannot close before D2 immutable integration; bind wheel/sdist-installed command envelopes and exit codes to the same candidate |
| `D7-CYCLE-SPEC-024` | Normative candidate exists, but the document itself says implementation acceptance is blocked | Freeze a machine-valid controller carrier/result schema, durable phase-event contract, exact lineage/GraphPatch identity, retry/resume and resource semantics; obtain both native implementability reviews |
| `D9-REDACTION-039` | Detailed draft exists; independent security review is blocked with eight release findings | Close wire truth, total sink inventory, pointer rules, bypass prevention, failure atomicity, derivatives and legacy migration before dispatching native lanes |
| `CTRL-DOCS-073` | Iterative docs maintenance is active | Cannot complete until API, Explorer, benchmarks, security, patterns and education dependencies are accepted; then run inventory, snippets, links and bilingual claim audit |
| `CTRL-EVIDENCE-BACKFILL-075` | Manifest exists with `candidates: []`; implementation was active during this audit | Finish append-only fail-closed checker, negative tests and independent review; bind each historical producer to one immutable candidate or assign zero weight |

### 4.2 Planned runtime, protocol, safety and conformance tasks — 32

| Task | Missing work / current dependency |
|---|---|
| `D4-TRACE-SUBGRAPH-022` | Waits for D2; must add namespace/checkpoint scopes, reducers and real stream/artifact edge execution plus trace contract |
| `D6-ROUTER-BARRIER-023` | **Ready now**: all registered predecessors are complete; implement conditional routes, durable decision events, deadlines/quorum and missing statistics in both runtimes |
| `D7-TS-CYCLES-025` | Waits for accepted D7 carrier/contract; implement bounded controllers and checked GraphPatch in TS |
| `D7-PY-CYCLES-026` | Waits for accepted D7 carrier/contract; implement native Python parity |
| `D7-CYCLE-CONFORMANCE-027` | Waits for both native cycle lanes; prove seen-set, every exit, hard accounting and hostile patches independently |
| `D8-RUNTIME-CHAOS-084` | Waits for cycle conformance; run deterministic retry/cancel/non-cooperative leak campaign |
| `D8-CHAOS-OPS-030` | Join only after runtime chaos and durable operational CLI both pass |
| `D9-APPROVAL-077` | Waits for accepted redaction contract; freeze authority, revision binding, expiry/revoke and idempotency |
| `D9-TS-REDACTION-087` | Waits for D9 contract; enforce sink-before-write in TS and scan every sink |
| `D9-PY-REDACTION-088` | Waits for D9 contract; enforce identical native Python behavior |
| `D9-REDACTION-CONFORMANCE-089` | Waits for both implementations; negative seeded leaks, migration, wire identity and independent security acceptance |
| `D9-DURABLE-EXT-SPEC-031` | Waits for redaction join; still needs leases, artifacts, snapshots, replay/fork and approval integration contract |
| `D9-TS-DURABLE-EXT-032` | Waits for extended contract and TS redaction; implement native stores/leases/replay/fork/approval |
| `D9-PY-DURABLE-EXT-033` | Waits for extended contract and Python redaction; implement native parity |
| `D9-DURABLE-EXT-CONFORMANCE-034` | Waits for both lanes, approval and redaction; prove crash windows, races, lineage, route replay, corruption and stale authority |
| `D9-OPS-CONTROL-085` | Waits for extended durability and chaos; implement durable status/watch/inspect/logs/pause/resume/cancel/retry envelopes |
| `D10-BUDGET-SPEC-035` | Waits for accepted D7 contract; freeze units, reservations, pricing identity and model routing |
| `D10-TS-BUDGET-036` | Waits for budget spec and extended durability; implement TS ledger/router/cost reporting |
| `D10-PY-BUDGET-037` | Waits for budget spec and extended durability; implement Python parity |
| `D10-BUDGET-CONFORMANCE-038` | Waits for both lanes; prove contention, every hard stop, resume safety and cost-envelope parity |
| `D11-VERIFY-SPEC-040` | Waits for router/barrier and approval; freeze votes, evidence, rubric versioning, abstention/unknown and human escalation |
| `D11-TS-VERIFY-041` | Waits for verifier spec and budget join; implement TS panels/citations/reflection |
| `D11-PY-VERIFY-042` | Waits for verifier spec and budget join; implement native parity |
| `D11-VERIFY-CONFORMANCE-043` | Waits for both lanes; prove maker/verifier isolation, citations, votes, unknown and stale human gate |
| `D12-ISOLATION-SPEC-044` | Waits for cycle/redaction/approval contracts; freeze deny-by-default capability and host boundary |
| `D12-TS-ISOLATION-045` | Waits for isolation spec; implement worktree/process/container, leases, path policy and merge gate |
| `D12-PY-ISOLATION-046` | Waits for isolation spec; implement native parity |
| `D12-ISOLATION-REDTEAM-047` | Waits for both native lanes and verifier; independently attack path, symlink, process/port/container, prompt and stale lease boundaries |
| `D13-ADAPTER-SPEC-048` | Waits for isolation red-team; define vendor-neutral mock-first adapter contract |
| `D13-TS-ADAPTERS-081` | Waits for adapter spec; implement TS mock/model/HTTP/shell/MCP adapters; live credentials remain opt-in |
| `D13-PY-ADAPTERS-082` | Waits for adapter spec; implement Python native counterparts |
| `D13-ADAPTERS-049` | Waits for both native lanes; independently join streaming/tools/usage/rate/circuit/fallback/cancel/redaction behavior |

### 4.3 Planned platform, distribution, quality and release tasks — 22

| Task | Missing work / current dependency |
|---|---|
| `D13-DX-051` | Waits for adapters; complete doctor, deterministic G0-G4 score, badge, picker and top-three remediation |
| `D14-API-FREEZE-050` | Waits for adapters, Python CLI and trace/subgraph; immutable export/API/envelope compatibility audit |
| `D14-MCP-PLUGINS-052` | Waits for API freeze and isolation; plugin SDK plus read-only-default, approval-gated MCP mutation |
| `D14-PATTERN-SKELETONS-053` | Waits for D2, verification, isolation and adapters; create honest YAML/JSON/TS/Python skeletons for all ten patterns |
| `D14-NPM-DIST-078` | Waits for API freeze; real unscoped npm package and both binaries, no workspace references; live namespace rehearsal is external |
| `D15-STORAGE-WORKERS-054` | Waits for durability, adapters and API freeze; PostgreSQL/S3/local artifacts/LockManager/workers and chaos conformance |
| `D15-EXPLORER-060` | Waits for stores, verifier, API and redaction; React Explorer, OTel, live/time-travel/critical-path views |
| `D15-PERFORMANCE-061` | Waits for storage, Explorer, API and skeletons; reproducible baseline and >10% gate |
| `D16-SECURITY-062` | Waits for complete attack surface and redaction join; secret/dependency/license/static/fuzz/prompt/SBOM campaign and zero unaccepted high/critical |
| `D16-PRIVACY-079` | Waits for redaction and isolation; default-off collection, retention, withdrawal and gallery consent; human data-owner approval is external |
| `D17-BETA-063` | Waits for security, performance and pattern skeletons; immutable package/API Beta and zero repository-owned P0/P1 |
| `D17-USABILITY-076` | Waits for Beta and privacy; requires five real consented external reports and 80% within 300 seconds |
| `D18-COMPAT-BENCH-064` | Waits for Beta; macOS/Windows, all runtime versions, 100-way/1,000-node, coverage and 100 randomized faults |
| `D18-SUPPORT-READINESS-080` | Waits for security and compatibility; runbooks, tabletop, redacted support bundle and acknowledged human roster/registry authority |
| `D18-EDUCATION-ASSETS-083` | Waits for complete patterns, Explorer, Beta and API; executable 14-step course, four cases, uncut demo and bilingual claim audit; external stories need consent |
| `D19-RC-065` | Waits for compatibility, API, npm distribution, all patterns, education, support and docs; clean install/upgrade/migration and signed RC |
| `D20-PROVENANCE-066` | Waits for RC/security; trusted npm/PyPI identity, SBOM, checksums, attestations and clean provenance; final rehearsal needs external authority |
| `D21-RELEASE-067` | Waits for provenance and signed roll-up; stable only if every blocking leaf passes, otherwise honest complete RC/no-release; publication authority external |
| `CTRL-PATTERNS-071` | Waits for all ten full bundles; reject directory/skeleton evidence and run every language/launcher/failure-resume E2E |
| `CTRL-ACCEPTANCE-070` | Waits for compatibility, security, RC, usability and chaos/ops; candidate-bound proof of every mandatory scenario/threshold |
| `CTRL-GROWTH-072` | Waits for DX and Explorer; honest launch assets, privacy-safe metrics and community operation; 6,000 stars is non-guaranteed outcome |
| `CTRL-RELEASE-ROLLUP-086` | Waits for provenance, acceptance, patterns, docs, growth, usability, support, mapping and backfill; fail-closed stable/RC/no-release decision with R3 review |

### 4.4 Ten complete pattern tasks — all planned

| Task | Missing complete-bundle gate |
|---|---|
| `PATTERN-01-RESEARCH` | Upgrade TS constructor to YAML/JSON/TS/Python mock E2E with budgets, permissions, settled failure and durable resume |
| `PATTERN-02-CITED` | Citation verification, source-quality evidence, abstention/unknown, adapters and resume |
| `PATTERN-03-AUTH` | Per-route runtime fan-out, fail-closed policy, adversarial verification, isolation and security |
| `PATTERN-04-DIFF` | Real risk routing, diverse judges, retained votes/unknown and resume |
| `PATTERN-05-UNTIL-DRY` | Runtime global-seen convergence, two dry rounds, verifier, budget exits and resume |
| `PATTERN-06-MIGRATION` | Worktree leases, test/merge gate, structured conflict, cleanup and resume |
| `PATTERN-07-CI` | Fake CI adapter, bounded retry, approval/idempotency, isolation and durable recovery |
| `PATTERN-08-DEPS` | Fake registry, per-package fan-out, license/security gates, isolated updates and resume |
| `PATTERN-09-PR` | Durable polling/waits, stale approval, idempotent writes, MCP policy and resume |
| `PATTERN-10-ECOSYSTEM` | Bounded schedule/fan-out/cost, providers, worker/storage, partial outage and replay |

No pattern currently satisfies `PB`; existing constructors/examples are useful
partial inputs only.

## 5. Release mapping, completion and dependency defects

### 5.1 Structural result

The machine structure passes: 178 unique leaves map exactly once, 175 are
blocking, only `REL-GR03/04/05` are non-blocking, all mapped tasks exist, the
107-task graph is acyclic, and all 42 blocking producers are in the 94-task
roll-up closure. The hostile checker passed 34 of 34 tests.

That structural success does **not** prove that each selected producer can
semantically satisfy its leaf. The following mappings can close a release row
too early unless the producer scope/dependencies are changed.

### 5.2 Release-producer semantic mismatches

1. **P0 — approval contract mapped as implementation evidence.**
   `REL-I05`, `REL-T22`, and `REL-RC08` map to `D9-APPROVAL-077`, whose title,
   artifacts and ownership are specification/fixture-only. Stale approval,
   at-least-once recovery and incident traces require native durable
   implementation and conformance. Map them to the appropriate extended
   durability/acceptance join or broaden the task with both native lanes.
2. **P0 — complete CLI rows mapped to an operational subset.** `REL-X09`,
   `REL-T29`, and `REL-PKG10` map to `D9-OPS-CONTROL-085`, but that task plans
   only status/watch/inspect/logs/pause/resume/cancel/retry. The release rows
   require the whole installed dual-language command matrix, including
   init/add/run/replay/fork/cost/score/badge/worktree/artifact/plugin/MCP.
3. **P1 — cross-ecosystem executable row mapped to npm only.** `REL-PKG05`
   maps to `D14-NPM-DIST-078`, whose tests cover npm tarballs and binaries;
   the leaf explicitly requires npm and Python installations.
4. **P1 — runtime/persistence schema safety mapped to D2 compiler work.**
   `REL-T05` maps to `D2-BUILDERS-YAML-020`, but the leaf includes node runtime
   input/output rejection before unsafe persistence. D2 does not own that
   runtime/durable property.
5. **P1 — composite safety invariant mapped to cycles alone.** `REL-I04`
   maps to `D7-CYCLE-CONFORMANCE-027`, while the leaf also requires unbounded
   retry rejection. D7's evidence plan does not include the later chaos/retry
   join.
6. **P1 — privacy tasks can precede implementation/package proof.**
   `REL-I06` and `REL-SC13` map to `D16-PRIVACY-079`, which does not depend on
   redaction conformance or clean RC package installs even though the leaves
   require redacted enabled capture and default-off clean npm/PyPI behavior.
7. **P1 — asset evidence mapped to policy-only producer.** `REL-DOC12` maps to
   privacy policy, but the leaf requires actual adopter/trace gallery entries,
   URLs and consent references. `REL-DOC01` maps to education assets but also
   requires the external Quickstart result; that producer does not depend on
   the usability task.
8. **P2 — future compiler equality is under-specified.** `REL-X02` maps to D2.
   D2 proves the current compiler corpus, but its evidence plan does not require
   revalidation of later router, patch, budget, capability, subgraph and plugin
   diagnostics. The candidate overlay must explicitly include that expanded
   corpus or the leaf should map to the final compatibility/acceptance join.

### 5.3 Missing or insufficient dependency edges

1. `D7-CYCLE-SPEC-024` should depend on `D2-BUILDERS-YAML-020`; GraphPatch
   revision/lineage cannot freeze independently of the accepted revision-1
   compiled identity and explicit controller carrier.
2. `D9-DURABLE-EXT-SPEC-031` includes approval semantics but does not depend on
   `D9-APPROVAL-077`.
3. `D9-DURABLE-EXT-CONFORMANCE-034` claims durable router replay but does not
   depend on `D6-ROUTER-BARRIER-023`.
4. `D10-BUDGET-CONFORMANCE-038` proves iteration/fan-out/node hard stops for
   `REL-T18` but has no dependency on `D7-CYCLE-CONFORMANCE-027`; a cycle spec
   alone is not an executable budget join.
5. `D4-TRACE-SUBGRAPH-022` claims executable stream/artifact edges but lacks a
   pipeline dependency and any artifact-store/durable-extension dependency.
   Either narrow it to the carrier/trace contract or add the producers needed
   for real execution.
6. `CTRL-GROWTH-072` owns the full release-beat asset row but depends only on
   DX and Explorer. It can structurally complete before Beta, RC/security and
   education assets exist. Add those joins or narrow it to preparatory plans.

### 5.4 Status and control-document inconsistencies

1. `CTRL-RELEASE-MAP-074` is registry-completed even though its independent
   review explicitly conditions acceptance on binding the reviewed working
   tree to an immutable commit. The map, checker and tests are still untracked.
2. `D9-REDACTION-039` has `blocker: null` and scanner `healthy`, while the
   independent security audit says blocked and lists eight release-blocking
   findings. `D7-CYCLE-SPEC-024` similarly declares implementation acceptance
   blocked inside the spec. The registry should preserve these acceptance
   blockers even while corrective work remains active.
3. The master plan and coverage matrix still say 6/77 evidence gates; the
   current scanner says 7/77. This is a stale counter, not meaningful progress
   toward the 178 release leaves.
4. Release-checklist section 17 still says `CTRL-RELEASE-MAP-074` is Open with
   no machine map, although the working-tree map/checker exists and passed.
   It must be updated only after immutable integration, without changing any
   `REL-*` status.
5. The ownership map still describes the standalone pipeline as active/local
   with merge gates open even though commit `3df201d` and its independent
   milestone evidence exist. Its broader Graph IR stream scope remains open,
   but the standalone scope should not be described as unintegrated.

## 6. Exact implementation priority and maximum useful concurrency

The repository has four total agent slots, including integration. The fastest
safe queue is dependency-driven, not “start every planned task”:

1. **Integration lane — immutable D2/D3 handoff.** Commit the exact accepted
   authoring/Python CLI tree, rerun candidate-safe gates serially where shared
   `dist/` is involved, add SHA-bound review/test evidence, then push. This
   unlocks D4 and makes the authoring surface reusable.
2. **Critical security lane — finish `D9-REDACTION-039`.** Resolve the eight
   independent findings, then fan out `D9-TS-REDACTION-087` and
   `D9-PY-REDACTION-088`; join with byte-level canary conformance. Redaction is
   on the longest release path and blocks durability, isolation, privacy,
   Explorer and security.
3. **Cycle lane — finish `D7-CYCLE-SPEC-024`.** Accept the explicit carrier,
   phase events, identity/CAS and retry rules; then run TS and Python cycle
   implementations in parallel and join. Start `D10-BUDGET-SPEC-035` as soon
   as the accepted cycle contract exists.
4. **Ready runtime lane — start `D6-ROUTER-BARRIER-023`.** This is the only
   currently planned feature task whose registered predecessors are all
   complete. Its completion unlocks verifier semantics and route-dependent
   patterns.
5. **Release-control lane — finish `CTRL-EVIDENCE-BACKFILL-075`.** Require
   immutable candidate, exact commands/env/results/digests, reviewer,
   exclusions and supersession; no candidate must remain a successful audit
   with zero release weight, while a requested incomplete candidate fails.
6. **Next unlocked lane — `D4-TRACE-SUBGRAPH-022`, then approval/durability.**
   After D2, freeze nested namespace/reducer/edge carriers. After redaction,
   start approval; after the redaction join, start extended durability. Do not
   jump to adapters, Explorer or pattern marketing before these contracts.

With four slots, the immediate allocation should keep integration plus three
independent bounded jobs active. When a contract freezes, replace its reviewer
slot with the two native implementation lanes only after freeing enough slots;
do not let two pack/build agents race over the same generated `dist/` tree.

## 7. Honest 21-day and 6,000-star boundary

The current dependency graph has a 32-task root-to-release path; 26 tasks on a
longest current path remain unfinished. Across the whole registry, 64 tasks are
still planned and six are in progress. All 175 mandatory release leaves are
still open, and the external gates include publishing authority, a human data
owner, five consented usability reports, the 80%-within-five-minutes result,
an acknowledged support roster, independent security/go-no-go review and
consented public stories/galleries.

Therefore 21 days remains an aggressive execution target, not evidence that
stable v1 or even a complete RC will exist automatically on Day 21. The plan's
fallback is correct: stable only if every conjunctive gate passes; otherwise an
accurately labeled complete RC if all RC assets pass, or no release if even the
complete-RC asset gate is missing.

The 6,000+ star objective is an organic stretch outcome, not a task that code
can complete or an outcome anyone can guarantee. Engineering can control
quality, time-to-first-success, truthful demos, documentation, contributor
response and launch experiments. It cannot control GitHub users' decisions.
Paid stars, bots, mutual-star schemes, fabricated adopters/reports, or false
popularity claims remain prohibited. A miss changes product/positioning work;
it never weakens a release gate.

## 8. Read-only verification run by this audit

Commands and observed results:

```text
corepack pnpm check:release-map
  178/178 leaves; 175 blocking; 3 non-blocking;
  42 blocking producers in 94-task roll-up closure;
  107 registry tasks; acyclic; 34/34 tests passed

python3 tools/progress-scanner/graph_progress.py \
  --repo /home/nick/work/GraphEngineering scan
  107 tasks; 42 healthy; 65 waiting; 0 stale/blocked/risk/warnings;
  7/77 evidence gates satisfied, 70 open

corepack pnpm check:docs
  201 local Markdown links passed

git diff --check
  clean

systemctl --user is-active graph-progress.timer
  active; 30-minute timer enabled
```

No workspace build, package pack, source formatter, branch switch, commit,
push, release mutation or functional source edit was performed by this audit.
