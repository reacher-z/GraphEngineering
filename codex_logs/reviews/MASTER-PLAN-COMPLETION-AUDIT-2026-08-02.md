# Master-plan completion audit — 2026-08-02 PDT

Disposition: **NOT COMPLETE / NOT RC-READY / NOT STABLE-V1-READY**

Audited authority:
`codex_plans/Graph-Engineering-21-Day-Master-Plan.md`, all 22,030 lines at
the start of this audit. The audit was read-only and independent of the P10
runtime implementers. This report records repository truth; it does not amend
or replace the append-only master plan.

## Release truth

- `scripts/check-release-task-map.mjs` passed 178/178 checklist leaves: 175
  blocking and 3 non-blocking. This proves the checklist-to-task map is closed,
  not that any release condition passed.
- `scripts/check-evidence-closure.mjs --json` returned audit-only mode,
  candidate `null`, zero selected tasks, and release weight `0/93`.
- Every release-checklist leaf remains Open. Candidate coordinates are empty.
- `HEAD` and `origin/feat/authoring-foundation` were both
  `1cb77f03bcfd785183cbaf819a02c287308e9bc0` before active P10 edits. The
  branch was 149 commits ahead of and zero behind `origin/main`, with no tag.
- Organic adoption and 5,000/6,000 GitHub stars remain targets. They are not
  code or test outcomes and cannot be declared complete in this repository.

## Verified bounded slices

The following work is real and reusable, but none is a substitute for the
complete plan:

1. Canonical initial Graph IR, strict JSON/bounded safe YAML, TS/Python graph
   builders, typed ports, revision-1 identity, and shared hashes.
2. Native deterministic DAG schedulers, standalone bounded pipelines, pure
   barriers/routers, integrated routing, and the current ordinary TypeScript
   barrier refusal/execution boundary.
3. Local event/checkpoint stores and event-sourced start/resume for local DAGs.
4. Deep bounded-cycle/GraphPatch/CycleStore source implementations and tests;
   final native/conformance tasks remain In Progress.
5. Deterministic mock and injected-transport HTTP adapter slices plus an
   always-refuse shell boundary; no real provider clients or isolated shell.
6. Same-host SQLite schema-v1 CycleStore and extensive private B2/B3 migration
   primitives.
7. P9 dual-runtime package-private transaction owner at commit `1cb77f0`:
   pre-I/O registration, 19 mutation/transaction guards, guarded BEGIN,
   returned-failure cleanup, parity, GC/privacy, and COMMIT hard-disabled.
8. Linux CI for Node 20/22 and Python 3.11/3.12/3.13, CodeQL, dependency
   review, local package rehearsals, governance and security-reporting files.
9. Fixture and documentation checks: 89 JSON fixtures, 46 case manifests, and
   478 local Markdown links at this checkpoint.

## Normative sections 10–30

| Plan area | Truth | Principal missing closure |
|---|---|---|
| §10 protocol/compiler | Partial | Full lowering, revision 2+, reducers/subgraphs, general runtime assignability, budget/capability enforcement, compatibility freeze |
| §11 execution kernel | Partial | Barrier tranche 2, durable decisions/replay, full failure policy and human/quorum joins |
| §12 cycles/GraphPatch | Deep partial | Final TS/Python hostile joins, candidate-bound conformance, synchronous timeout decision |
| §13 subgraph/stream/trace | Contract only | Both native runtimes and trace viewer; fixture still says `implementationClaim:false` |
| §14 durability/storage | Partial | Unified leases/locks, scheduler replay/fork, approvals, artifacts, acceleration, Postgres/S3/workers, complete SQLite publication |
| §15 redaction/policy | Narrow path only | Full 57x54 sink inventory, all-sink protection, legacy migration, approval, capability enforcement, independent security join |
| §16 budget/model/provider | Contract partial | Native ledgers/reservations/model routing/pricing/cost, real provider clients |
| §17 verification | Contract only | Reflection, refutation, lenses, citations, judges, votes, abstention/unknown/human gates |
| §18 isolation | Contract only | Deny-by-default capability runtime, worktree/process/container isolation, merge gate and escape red team |
| §19 SDK/CLI/MCP/plugins | Partial | Operational command set, score/badge/picker, mutating policy-gated MCP, plugin SDK/discovery |
| §20 Explorer/OTel | Absent | React Explorer, live traces, OTel, critical path/utilization, replay/fork time travel |
| §21 patterns | 1/10 physical bundle | Nine full bundles plus complete cross-language/budget/permission/failure/resume/provider guides |
| §22 course | Absent | Fourteen executable modules and case studies |
| §23 QA | Partial | 90/85 coverage gate, macOS/Windows, 100 random faults, 1,000-node resource evidence, fuzz/soak/perf/flake reports |
| §24 distribution | Local rehearsal only | Canonical unscoped npm, trusted npm/PyPI, checksums/SBOM/attestations, upgrade matrix, RC/tag |
| §25 adoption/support | Plans/templates only | Five external reports, 80% five-minute completion, consent evidence, support drill/roster, observed metrics |
| §§26–30 roll-up | Open | One immutable candidate with every mandatory evidence leaf and provenance artifact |

## Highest-fan-out blockers

1. D9 redaction: current conformance fixture remains implementation-false and
   only a narrow protected-journal path exists; public legacy sinks remain.
2. D4 subgraph/reducer/artifact/stream/trace: contract P1s and both native
   implementations remain open.
3. D6 barrier tranche 2: arming, dispositions, deadlines, non-pass outcomes,
   late arrival, cancellation, durable decision and zero-rejudge replay.
4. D7 final native/conformance closure and the synchronous handler timeout
   divergence decision.
5. D9 approvals and extended durability: leases/races, replay/fork, artifacts,
   checkpoint acceleration and production stores/workers.
6. D10 budget, D11 verification and D12 isolation, which must close before
   provider/API/plugin claims can freeze.

The SQLite P10 lane may progress independently but must not consume all
implementation capacity while these release-spine predecessors remain open.

## P10 boundary

The active P10 task is limited to:

```text
exact Rule 11 owner
  -> bounded Rule 12 main/TEMP seal acceptance
  -> exact Rule 12 receipt
  -> authenticated before-verification observation
  -> unconsumed third evidence (observed/consumed = 3/2)
```

P10 cannot claim cursor-clock completion, lineage/metadata/rules publication,
fresh-v2, TEMP retirement, fourth clock, final transaction fence, COMMIT,
complete-v2, crash/process recovery, public API, manifest activation, RC, stable
release, or stars.

## Control remediation closure (follow-up)

The previously rejected control-plane batch was remediated and independently
re-audited. Candidate validation now reads the registry and artifact bytes from
the immutable candidate Git tree, rejects dirty-worktree and symlink
substitutions, enforces canonical UTC chronology, rejects duplicate raw JSON
keys, and disallows strict-mode evidence waivers. The graph checker now enforces
70 machine-readable semantic edges and invalidates completed consumers when a
required predecessor reopens.

The accepted gate run on 2026-08-02 reported 111 registry tasks (43 completed),
297 dependency edges, 70 semantic edges, an acyclic graph, 12/12 task-control
mutation tests, 40/40 release-map tests, and 102/102 evidence-closure tests.
Audit-only evidence truth remains unchanged: no selected candidate and 0/93
release weight. This closure accepts the control mechanism only; it does not
claim that P10 or the master plan is complete.

## Control-plane findings and remediation status

The audit found that the registry had not absorbed the accepted SQLite B3/P9
work and that the coverage matrix was dated 2026-07-26. Active remediation
registered the exact Rule 11 predecessor, P9, and P10 as supporting tasks with
no direct release weight. A later scanner run reported 111 tasks, 47 healthy,
61 waiting, 3 stale, 0 blocked/integration-risk, and 15/81 evidence gates.

The audit also proved that the planning documents named strict registry and
dependency-graph checkers that did not exist. Initial implementations were
added, but independent hostile review rejected their first version: candidate
mode read the dirty worktree, `evidence_required:false` waived strict checks,
ordinary `JSON.parse` accepted duplicate keys, semantic dependency rules were
absent, timestamps/references were weak, and an old Rule 11 review could not
substantiate later hostile fixes. Those findings remain blockers until the
remediated checkers and mutation tests pass independent review. A five-test
structural pass is not evidence closure.

## Final disposition

The repository is a substantial early alpha with unusually deep bounded safety
work. It is not the completed 21-day product, a complete RC, stable v1, or an
evidence-backed 5K/6K-star outcome. The next accepted state requires P10 to pass
both native lanes, portable parity, hostile/GC/privacy tests and independent
review while COMMIT remains disabled; the broader release spine then continues
through redaction, D4, D6/D7 and all later plan gates.
