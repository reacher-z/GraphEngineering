# CTRL-RELEASE-MAP-074 independent semantic closure review

- Review time: `2026-07-26T22:08:16Z`
- Reviewer duty: independent hostile release-map semantics reviewer
- Authority: `codex_plans/Graph-Engineering-21-Day-Master-Plan.md`
- Control under review: `CTRL-RELEASE-MAP-074`
- Mutable-worktree verdict: **ACCEPT FOR IMMUTABLE BINDING**
- Control status after review: **reopened / in progress**
- Stable-release implication: **none**
- Checklist implication: all 178 release leaves remain `Open`

## 1. Decision

The remediated release-task map is semantically acceptable at the reviewed
mutable-worktree state. Every one of the 178 canonical release leaves has one
explicit primary producer, every producer is selected at the earliest task
whose own dependency and evidence contract can prove the complete checklist
sentence, and the only non-blocking leaves remain the three organic outcome
observations `REL-GR03`, `REL-GR04`, and `REL-GR05`.

This is not a completion record and is not candidate evidence. The prior
completion was explicitly reopened because its references described a
42-blocking-producer map and a 34-test suite. Those coordinates predate the
semantic remediation. Later append-only failed/superseding records now prevent
that historical evidence from contributing completion weight. The task must
stay `in_progress` until the integration owner binds the remediated map, the
40-test hostile suite, this review, and the exact verification output to one
immutable revision and appends fresh passing evidence for all five expected
test requirements.

At this snapshot the review has no remaining P0 or P1 semantic-map finding.
One P2 operational condition remains: immutable revision binding has not yet
occurred. That condition intentionally blocks completion of this control but
does not invalidate the semantic content accepted here.

## 2. Material reviewed

The review read the following inputs in full rather than relying on prior
summaries:

1. the complete 21-day master plan;
2. all fourteen canonical release-checklist tables and the control overlay;
3. the complete task dependency graph, including the semantic-join section;
4. all 178 entries in `release-task-map.json`;
5. all 107 live task-registry entries, their direct dependencies, statuses,
   expected artifacts, expected tests, and evidence records;
6. the structural checker and its complete hostile test suite;
7. the original independent release-map review;
8. the semantic-remediation review; and
9. the evidence-remediation and progress-scanner state relevant to historical
   completion and candidate weight.

The leaf inventory was rebuilt from the checklist tables. The producer set was
rebuilt from the machine map. Dependency closure was recomputed from the live
registry. No count, producer assignment, release status, or evidence claim was
accepted solely because an earlier review stated it.

## 3. Independent inventory

| Checklist family | Leaves |
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
| Pattern bundle and ten patterns | 11 |
| Documentation/assets | 16 |
| Growth/community | 7 |
| Support | 8 |
| RC fallback | 10 |
| **Total** | **178** |

Validated structural state:

- 178 exact canonical checklist leaves;
- 178 mappings and no duplicate or uncovered leaf;
- 175 blocking leaves;
- exactly three non-blocking leaves: `REL-GR03`, `REL-GR04`, `REL-GR05`;
- 37 distinct blocking primary producers;
- every blocking producer is inside the 94-task transitive predecessor closure
  of `CTRL-RELEASE-ROLLUP-086`;
- 107 unique live registry tasks;
- no dangling registry dependency;
- no dependency cycle; and
- every one of the 178 release rows is still `Open` or `Open; ...`.

## 4. Newly discovered P0 partial-producer defects

Five mappings survived the earlier broad remediation but could still close a
whole checklist sentence from an earlier task that proved only a subset. Each
could allow a stable release decision to advance without required final
evidence, so each was classified P0 at discovery. All five are closed.

| Release leaf | Partial producer rejected | Complete producer now bound | Why the old binding was fail-open |
|---|---|---|---|
| `REL-V1-02` | `D16-SECURITY-062` | `CTRL-ACCEPTANCE-070` | D16 covers runtime/public-surface security preflight, but stable-v1 acceptance also requires installed candidate artifacts, support sinks, package/supply-chain scans, and an independent final-candidate disposition over `T09`, `T15`, `T23`-`T28`, and `Q08`. |
| `REL-X02` | `D2-BUILDERS-YAML-020` | `D18-COMPAT-BENCH-064` | D2 proves the initial compiler slice. It cannot prove identical verdicts, diagnostics, and stable error codes for every compiler feature and positive/negative fixture added through the later graph, durability, cycle, routing, and operational work. |
| `REL-SC07` | `D16-SECURITY-062` | `D20-PROVENANCE-066` | D16 runs source/runtime security checks before final packages and support assets exist. The checklist explicitly requires repository history, final npm/Python packages, source maps, docs, traces, and support bundles with positive and seeded-negative controls. |
| `REL-DOC16` | `D19-RC-065` | `CTRL-RELEASE-ROLLUP-086` | D19 freezes installed packages and references, but the site, release notes, changelog, package READMEs, draft GitHub Release, final channel copy, and consolidated known-limit list only converge at the final roll-up. |
| `REL-RC03` | `D19-RC-065` | `CTRL-RELEASE-ROLLUP-086` | Package versioning alone cannot prove that every site/docs/channel surface labels fallback output as a complete RC and never implies stable or production-proven status. |

The hostile suite now mutates each of these five bindings back to its old
partial producer and requires all five substitutions to fail.

## 5. Whole-requirement join audit

The complete mapping was reviewed using one rule: a primary producer may close
a release leaf only if that task's own artifacts and tests, together with its
hard predecessor closure, can prove every clause of the leaf. Temporal order,
title similarity, or implementation of one noun in the sentence is not enough.

The principal late joins are now explicit:

- `D18-COMPAT-BENCH-064` joins the canonical compiler, both source CLIs, later
  compiler features, operational commands, DX, OS behavior, interop, chaos,
  and scale evidence.
- `D19-RC-065` joins clean installed npm and Python artifacts, both executable
  names, the complete installed CLI, runtime/OS matrices, upgrade paths, API
  identity, and reference-surface consistency.
- `D20-PROVENANCE-066` joins final package contents, namespace authority,
  default-off observation, SBOM/checksum/attestation identity, reproducibility,
  the full release secret scan, and prerelease invalidation behavior.
- `CTRL-ACCEPTANCE-070` joins cross-cutting runtime, persistence, safety,
  security, structured-failure, adapter/storage, X01-X10, and coverage
  invariants after candidate artifacts and provenance exist.
- `D18-SUPPORT-READINESS-080` joins redaction, support-bundle sinks,
  disclosure, incident recovery, idempotency, approval, and compensation.
- `CTRL-GROWTH-072` joins authentic public entries with privacy, consent,
  withdrawal, usability, education, and organic-conduct controls.
- `CTRL-RELEASE-ROLLUP-086` joins final assets, claims, candidate identity,
  known limits, RC labeling, invalidation, and stable/RC/no-release decision.

The task DAG records these joins and explicitly says that early component tasks
cannot close the broader final-compiler, stable-security, full-secret-scan,
surface-identity, or fallback-RC requirements on their own.

## 6. Exhaustive producer-to-leaf ledger

This is the reviewed semantic ledger for all 178 leaves. The count in each row
is part of the audit; the rows sum to 178 and contain no duplicate leaf.

| Whole-requirement producer | Count | Release leaves |
|---|---:|---|
| `CTRL-ACCEPTANCE-070` | 17 | `REL-V1-01`, `REL-V1-02`, `REL-V1-03`, `REL-I02`, `REL-I03`, `REL-I04`, `REL-I05`, `REL-I07`, `REL-X06`, `REL-X10`, `REL-T05`, `REL-T11`, `REL-T15`, `REL-T27`, `REL-Q01`, `REL-Q02`, `REL-Q03` |
| `CTRL-DOCS-073` | 2 | `REL-DOC05`, `REL-DOC10` |
| `CTRL-GROWTH-072` | 10 | `REL-UX09`, `REL-DOC12`, `REL-DOC14`, `REL-GR01`, `REL-GR02`, `REL-GR03`, `REL-GR04`, `REL-GR05`, `REL-GR06`, `REL-GR07` |
| `CTRL-PATTERNS-071` | 2 | `REL-T31`, `REL-PAT00` |
| `CTRL-RELEASE-ROLLUP-086` | 11 | `REL-V1-06`, `REL-V1-07`, `REL-V1-08`, `REL-I10`, `REL-DOC16`, `REL-RC01`, `REL-RC02`, `REL-RC03`, `REL-RC04`, `REL-RC05`, `REL-RC09` |
| `D10-BUDGET-CONFORMANCE-038` | 1 | `REL-T18` |
| `D11-VERIFY-CONFORMANCE-043` | 2 | `REL-I09`, `REL-T16` |
| `D12-ISOLATION-REDTEAM-047` | 3 | `REL-T09`, `REL-T23`, `REL-T24` |
| `D13-ADAPTERS-049` | 2 | `REL-T25`, `REL-Q06` |
| `D13-DX-051` | 1 | `REL-DOC09` |
| `D14-NPM-DIST-078` | 1 | `REL-PKG02` |
| `D15-EXPLORER-060` | 2 | `REL-DOC03`, `REL-DOC11` |
| `D15-PERFORMANCE-061` | 2 | `REL-Q07`, `REL-DOC07` |
| `D15-STORAGE-WORKERS-054` | 1 | `REL-T30` |
| `D16-PRIVACY-079` | 1 | `REL-I06` |
| `D16-SECURITY-062` | 8 | `REL-I08`, `REL-T28`, `REL-Q08`, `REL-SC08`, `REL-SC09`, `REL-SC10`, `REL-SC11`, `REL-SC12` |
| `D17-USABILITY-076` | 12 | `REL-V1-05`, `REL-Q10`, `REL-Q11`, `REL-UX01`, `REL-UX02`, `REL-UX03`, `REL-UX04`, `REL-UX05`, `REL-UX06`, `REL-UX07`, `REL-UX08`, `REL-UX10` |
| `D18-COMPAT-BENCH-064` | 10 | `REL-I01`, `REL-X02`, `REL-X07`, `REL-X09`, `REL-T10`, `REL-T32`, `REL-T33`, `REL-Q04`, `REL-MX-X01`, `REL-MX-X02` |
| `D18-EDUCATION-ASSETS-083` | 6 | `REL-DOC01`, `REL-DOC02`, `REL-DOC04`, `REL-DOC06`, `REL-DOC08`, `REL-DOC13` |
| `D18-SUPPORT-READINESS-080` | 12 | `REL-T26`, `REL-SUP01`, `REL-SUP02`, `REL-SUP03`, `REL-SUP04`, `REL-SUP05`, `REL-SUP06`, `REL-SUP07`, `REL-SUP08`, `REL-RC07`, `REL-RC08`, `REL-RC10` |
| `D19-RC-065` | 27 | `REL-T29`, `REL-Q05`, `REL-MX-N01`, `REL-MX-N02`, `REL-MX-N03`, `REL-MX-N04`, `REL-MX-N05`, `REL-MX-N06`, `REL-MX-P01`, `REL-MX-P02`, `REL-MX-P03`, `REL-MX-P04`, `REL-MX-P05`, `REL-MX-P06`, `REL-MX-P07`, `REL-MX-P08`, `REL-MX-P09`, `REL-PKG04`, `REL-PKG05`, `REL-PKG06`, `REL-PKG07`, `REL-PKG08`, `REL-PKG09`, `REL-PKG10`, `REL-PKG11`, `REL-PKG12`, `REL-DOC15` |
| `D2-BUILDERS-YAML-020` | 6 | `REL-X01`, `REL-T01`, `REL-T02`, `REL-T03`, `REL-T04`, `REL-T06` |
| `D20-PROVENANCE-066` | 15 | `REL-V1-04`, `REL-Q09`, `REL-PKG01`, `REL-PKG03`, `REL-PKG13`, `REL-SC01`, `REL-SC02`, `REL-SC03`, `REL-SC04`, `REL-SC05`, `REL-SC06`, `REL-SC07`, `REL-SC13`, `REL-SC14`, `REL-RC06` |
| `D6-ROUTER-BARRIER-023` | 3 | `REL-X04`, `REL-T07`, `REL-T13` |
| `D7-CYCLE-CONFORMANCE-027` | 2 | `REL-T08`, `REL-T17` |
| `D7-PIPELINE-CONFORMANCE-013` | 1 | `REL-T12` |
| `D9-DURABLE-EXT-CONFORMANCE-034` | 8 | `REL-X03`, `REL-X05`, `REL-X08`, `REL-T14`, `REL-T19`, `REL-T20`, `REL-T21`, `REL-T22` |
| `PATTERN-01-RESEARCH` | 1 | `REL-PAT01` |
| `PATTERN-02-CITED` | 1 | `REL-PAT02` |
| `PATTERN-03-AUTH` | 1 | `REL-PAT03` |
| `PATTERN-04-DIFF` | 1 | `REL-PAT04` |
| `PATTERN-05-UNTIL-DRY` | 1 | `REL-PAT05` |
| `PATTERN-06-MIGRATION` | 1 | `REL-PAT06` |
| `PATTERN-07-CI` | 1 | `REL-PAT07` |
| `PATTERN-08-DEPS` | 1 | `REL-PAT08` |
| `PATTERN-09-PR` | 1 | `REL-PAT09` |
| `PATTERN-10-ECOSYSTEM` | 1 | `REL-PAT10` |

## 7. Dependency-bypass and evidence-contract audit

Binding a leaf to a later task is insufficient if that task can bypass a
required producer or complete with generic evidence. The live registry was
therefore hardened and the test suite now freezes semantic contracts for all 37
mapped producers plus four dependency-only join tasks.

Representative fail-closed contracts include:

- cycle specification consumes the actual builder/revision contract and tests
  malicious patch rejection;
- durable extension specification consumes approval and redaction contracts;
- durable conformance consumes router/barrier behavior and rejects replay
  re-judgment and stale approvals;
- D10 consumes native cycle conformance and tests every hard bound dimension;
- privacy consumes the redaction join and proves enabled capture is redacted
  before every sink;
- D18 source parity consumes operations and DX and requires the complete
  positive/negative compiler corpus;
- D19 consumes npm distribution, source compatibility, education, support,
  docs, and patterns before testing packed npm plus wheel/sdist artifacts;
- D20 consumes D19 and D16 before testing the complete final secret-scan and
  provenance surface;
- stable acceptance consumes D20, not only D16, before making the final
  security decision;
- final roll-up consumes mapping, evidence backfill, acceptance, provenance,
  patterns, docs, growth, usability, and support before any decision; and
- every pattern task must produce its own `manifest.json` and pass the complete
  pattern-bundle schema requirements.

Negative mutations remove representative graph-IR, router replay, installed
Python, compensation, final-security/provenance, full-secret-scan,
surface-identity, and final-compiler dependencies or evidence. Every mutation
is rejected.

## 8. Status and blocking-classification audit

The map does not treat implementation plans, local tests, historical completed
statuses, or the progress scanner as release evidence.

- All 178 checklist rows remain `Open`; none was changed to `Green`.
- Every mandatory row remains blocking.
- Only organic star/watch/fork outcomes `GR03`, `GR04`, and `GR05` are
  non-blocking observations.
- Product-quality, security, documentation, support, governance, and honest
  growth-process rows remain blocking even though the aspirational 6,000-star
  outcome itself cannot be guaranteed or manufactured.
- The release roll-up cannot authorize stable publication while any blocking
  leaf is `Open`, `Partial`, or `Blocked`.
- Historical completed tasks carry zero candidate weight until the separate
  evidence-backfill control binds candidate revision, digests, commands,
  environments, outcomes, exclusions, and independent review.

## 9. Historical evidence supersession

The registry deliberately preserves the original evidence records for audit
history. It does not delete or rewrite them. It appends later failed records
with a newer timestamp for the same requirements and reopens the task.

The historical completion references are insufficient because they assert:

- `42` blocking producers rather than the current semantically consolidated
  set of `37`; and
- `34/34` hostile tests rather than the current `40/40` suite, which includes
  the five newly rejected partial-producer substitutions and complete semantic
  task-contract checks.

The checker test `the pre-remediation 42-producer and 34-test completion cannot
impersonate the semantic map` enforces this boundary. While the control is
reopened it requires the latest records not to pass. If a future integration
owner marks the task completed, the same test instead requires fresh passing
evidence for all expected tests, rejects references containing the old
`34/34`/`42 blocking producers` coordinates, and requires the superseding
`semantic-independent` review in completion evidence.

Therefore the progress scanner's single integration-risk signal for
`CTRL-RELEASE-MAP-074` is intentional and correct. It must disappear only after
immutable rebinding, not merely because this mutable review exists.

## 10. Hostile verification

Commands run from `/home/nick/work/GraphEngineering`:

```text
node --check scripts/tests/release-task-map.test.mjs
node scripts/check-release-task-map.mjs --json
corepack pnpm check:release-map
corepack pnpm check:evidence-closure
corepack pnpm check:docs
python3 tools/progress-scanner/graph_progress.py --repo /home/nick/work/GraphEngineering scan
git diff --check
```

Observed results:

- checker JSON: `ok=true`, 178 release leaves, 178 mappings, 175 blocking,
  3 non-blocking, 37 blocking producers, 94 roll-up ancestors, 107 registry
  tasks;
- hostile suite: `40/40` passed;
- immutable evidence-closure hostile suite: `102/102` passed in audit-only
  mode; the dynamic final-roll-up ancestor set contains 93 required tasks,
  no candidate is selected, and release weight remains exactly `0/93`;
- JavaScript syntax check: passed;
- dependency graph: acyclic;
- documentation links: 228 local links checked;
- whitespace/error check: `git diff --check` passed;
- progress scanner: 107 tasks, 40 healthy, 66 waiting, 0 stale, 0 blocked,
  1 intentional integration risk, 1 heartbeat warning;
- the liveness scanner's workflow-evidence view reports only 6 of 77 gates
  satisfied; independently, the immutable candidate overlay reports no selected
  candidate and zero release weight, so release remains fail-closed.

Mutable snapshot hashes for comparison only:

```text
61b3b8942f05c6cd9b510b4183114dbf907946c985de4e384d64549375d150ea  codex_plans/delivery/release-task-map.json
19f2dcdbfec2a358217e7a7293390887539ce972165779b9fb4c89abc19dbfb0  codex_plans/delivery/release-checklist.md
5091e1117ac873baa9cdcabba19e380cd96cf37ee5719f0eeb1c3e0651511fac  codex_plans/delivery/task-dependency-graph.md
72fa61587ca2034d9ad2ecbf4f21e6ab54c32a8f34ae3a18a5e18c608d76a6d5  codex_logs/task-registry.json
c2078e04a4793e39b30b9550c93043fdac1c30143ea51d4338bb4c06c411bcf7  scripts/check-release-task-map.mjs
4272c8e8f05d3e75c56a053bff624b0f376c87e9001ea391c9792810d59bf68c  scripts/tests/release-task-map.test.mjs
```

These hashes are not candidate evidence and may change before integration.
The integration owner must compute and record the immutable commit coordinates
and rerun the gates from that revision.

## 11. Remaining findings and acceptance boundary

| Severity | Remaining | Disposition |
|---|---:|---|
| P0 | 0 | All discovered release-bypass and partial-producer defects are closed in the reviewed semantic map. |
| P1 | 0 | Full inventory, classification, dependency closure, evidence contracts, and hostile regressions pass. |
| P2 | 1 | Immutable control-revision binding is pending; keep `CTRL-RELEASE-MAP-074` reopened and `in_progress`. |

Final verdict: **ACCEPT FOR IMMUTABLE BINDING**.

This verdict accepts the semantic release-control content only. It does not
claim that the 21-day development plan is complete, does not satisfy external
usability/security/registry/support gates, does not guarantee organic stars,
does not authorize publication, and does not mark any release leaf Green.
Only a later candidate-bound final roll-up may choose stable v1, complete RC,
or no release.
