# Master Plan Completion Audit — 2026-07-28

## Verdict

The 21-day master plan is not complete. This audit is deliberately a
requirement-to-evidence audit, not a search for plausible-looking files. Three
independent agents read the complete 10,372-line plan and inspected the live
worktree, task registry, test surfaces, package exports, CI, release evidence
and GitHub state. A requirement is counted complete only where current runtime
behavior and a proportionate verification gate prove it.

The repository is a substantial and well-tested `0.1.0-alpha.1` foundation.
It is not a release candidate, Stable v1, full Graph Engineering product, or
completed adoption campaign.

## Audit snapshot

- Audited committed base: `07e7d78ed8628deab70a9392dc3e9415a525e4ee` on
  `feat/authoring-foundation`.
- Task registry: 107 tasks total — 41 completed, 7 in progress, 59 planned.
- Evidence scanner: 77 gates require evidence; 13 satisfied and 64 open.
- Release checklist: 178 leaf requirements remain Open; no candidate is
  selected and the selected release weight is 0/93.
- SQLite reconciliation registry: 54 rules,
  `implementationClaim:false`, `releaseGate:false`, and
  `productionThroughputClaim:false`.
- Active npm/Python SQLite runtime artifacts still stop at schema v1 and
  migration `0001`; schema v2/`0002` is a spec preview, not an active runtime
  migration.
- Remote release state: only `v0.1.0-alpha.1` prerelease, no stable/latest
  release.
- Remote adoption snapshot: 0 stars, 0 forks and 0 watchers. The 6,000-star
  value is a stretch outcome metric, not an engineering completion fact.
- `origin/main` is behind the feature branch and there is no integration PR for
  the current branch; CI on another ref is not candidate evidence for this
  worktree.

The progress scanner and its 30-minute timer are operating, but scanner health
only proves that tasks are being observed. It cannot turn waiting or planned
tasks into completed implementation evidence.

## Requirement-to-evidence matrix

| Plan area | Audit status | Authoritative evidence | Missing completion evidence |
| --- | --- | --- | --- |
| Versioned Graph IR and authoring | Partial | JSON/YAML/builder paths, canonical bytes/hash, component and revision identities | Closed per-kind node configuration, general schema assignability, compatibility/migration chain |
| Compiler | Partial | Deterministic structural, DAG, reachability, depth/fan-out, port and identity checks | Full planned 17-pass lowering, closed immutable execution plan, candidate coverage/performance evidence |
| DAG scheduler | Partial | Ready queue, bounded concurrency, retry, timeout, cancellation, structured failures and durable terminal reuse | Per-kind/resource admission, complete failure algebra, conditional edge scheduling, human gates |
| Pipeline | Standalone slice complete | Real bounded buffers, backpressure, retry and cancellation with cross-language cases | Graph IR stream-edge lowering, durable offsets/ack/join/recovery |
| Router/barrier | Evaluators complete; runtime incomplete | Cross-language route-selection and settled-barrier pure evaluators | Conditional edges, durable route decisions, deadline/quorum waiting, late-arrival algebra, replay without rejudging |
| Bounded cycles/GraphPatch | Deep alpha, final join incomplete | Three controller modes, hard stops, patches, recovery, lineage, lease and extensive fault matrices | Ordinary scheduler integration, production controller store, all terminal/budget candidate gates; tasks 025/026/027 remain in progress |
| Nested subgraph/reducer/artifact/stream/trace | Not implemented natively | Contract candidates and some untracked schemas | Compiler lowering and TS/Python runtime execution; D4 task remains in progress |
| Durable runtime | Partial | Memory/JSONL events, file checkpoints, CAS terminal resume, cycle replay/fork | Production lease-coordinated controller storage, unified graph replay/fork, approvals, artifact store, distributed workers |
| SQLite baseline through legacy campaign | Completed private slices | Cross-runtime source, FILE-backed TEMP stage, cooperative handoff and stream/record/checkpoint/lease-lock-hold/legacy campaigns | Does not include cursor campaign, migration publication or production scale |
| Cursor immutable seal A1 | Complete | Private 18-column readers, 18-contribution carrier, constant-space seal, shared roots and adversarial tests | No database campaign or pre-rebind completion claim |
| Cursor clock A2a | Completed in current dirty worktree, awaiting commit | Three-field frozen evidence, identical normalized SQL and full retained/excluded/safe-integer hostile evidence | A2b receipt/session/projection binding remains open |
| Cursor A2b | Not implemented | Plan contract only | Later cursor maximum, exact projection/session authority and opaque one-shot pre-rebind receipt contract |
| Cursor Slice B rules 1–10 | Not implemented | Registry and detailed plan only | TEMP seal stage, lifecycle, ten diagnostics, fixtures, history binding and `pre-rebind-complete` |
| Post-rebind rules 11–12 | Not implemented | Registry and plan only | Publication-owned update count, second immutable seal, final mutable identity proof |
| SQLite `0002` and v2 publication | Not implemented in runtime | Canonical spec preview validates | Active migration artifact, crash-safe execution, permanent v2 baseline, runtime manifest switch and replay/reconciliation |
| SQLite scale/crash evidence | Insufficient | 128/1,024 functional characterization | 10K/100K RSS and latency, SIGKILL/crash replay, catalog/tenant-prefix production cost |
| Failure algebra | Partial | Fail/skip, pipeline stop/drop/dead-letter, structured errors | Unified fallback/compensate/partial/quorum/human/fail-fast semantics |
| Patterns | Constructor slice only | Four TypeScript graph constructors | Ten complete TS/Python runnable bundles, recovery/provider setup, manifests, runbooks and e2e evidence |
| CLI | Alpha authoring commands | init/validate/compile/plan/visualize/doctor | Full run/operate/recovery/cost/artifact/plugin/adapter/MCP/support command matrix |
| Model/tool/provider adapters | Not implemented | Storage provider contract only | Deterministic model mock, hosted model adapters, HTTP/shell/MCP tools, rate limits, breaker/fallback and conformance |
| Budget/model routing | Contract work in progress | Candidate schemas/semantics | TS/Python ledger, reservation/settlement, pricing snapshots, hard stops and CLI cost surface |
| Isolation/security | Partial | Threat boundary, CodeQL, dependency review, reporting policy | Capability enforcement, approval authority, worktree/process/container providers, red-team and candidate supply-chain gates |
| Observability/Explorer | Not implemented | Runtime events and static Mermaid/DOT | OTel/exporters/metrics/redaction queues, backend, React Explorer, live updates, time travel and accessibility |
| Education/course | Partial documentation | Quickstart, concepts, failure/security/CLI/SQLite documents | Fourteen executable modules, paired failures/fixes, exercises, bilingual complete assets |
| Quality gates | Strong slice evidence, candidate gate incomplete | Large native suites and cross-language conformance | 90/85 coverage, full fuzz/property/chaos, 100-run randomized faults, macOS/Windows, flake report |
| Release/provenance/support | Not complete | Alpha package rehearsal and community files | Beta/RC candidate, SBOM/attestation/provenance, trusted publishing, rollback rehearsal and support readiness |
| Community/adoption/stars | Not complete | README/governance/templates/discussions exist | External users/contributors, non-maintainer engagement, adoption cohorts and star outcome |

## Verified A2a correction in this worktree

The prior source summary used one maximum containing cursor creation and
consumption clocks. That caused a cursor-only regression to fail as generic
source corruption before the future cursor rule could own its diagnostic. The
current TypeScript/Python A2a correction replaces it with exactly three frozen
logical fields in canonical order:

1. `capturedAtMs` / `captured_at_ms`;
2. `maximumNonCursorObservedAtMs` /
   `maximum_non_cursor_observed_at_ms`;
3. `providerHighWaterAtMs` / `provider_high_water_at_ms`.

The normalized SQL is byte-identical across runtimes and has SHA-256
`c85e9836aadf613752aa9ba078c00248a4aa5cc3faafda916409b1ddf3201e1b`.
It retains all fifteen non-cursor observation branches and removes only cursor
`created_at_ms` and non-null `consumed_at_ms`. Cursor expiry, lease/migration-
lock future expiry and checkpoint RFC3339 timestamps also remain excluded by
contract.

The shared literal clock is `1785110405000`, with an ahead delta of `60000`.
Both runtimes prove that a physical cursor accepted by the 18-column A1 decoder
can have creation/consumption clocks ahead of the provider high-water without
source-capture failure. They also prove every retained branch, explicit
exclusion, capture/high-water ordering, `MAX_SAFE_INTEGER`, out-of-range,
negative and STRICT fractional behavior. Final independent A2a review is
HIGH 0 / MEDIUM 0 / LOW 0.

This is only A2a. It does not emit `BLR_CURSOR_EXPIRY_CONSUMPTION`; the future
Slice B campaign will own that diagnostic.

## Immediate execution queue

### Queue 1 — A2b cursor ownership contract

A2b must remain private and must not create a TEMP cursor campaign or sign a
completion state. It must freeze:

- constant-space later-cursor maximum ownership with an explicit empty-cursor
  representation;
- safe-integer validation for cursor creation and non-null consumption clocks;
- exact binding to A1 seal count/root and source descriptor/schema identities;
- the complete six-field projection identity and exact projection object
  reference;
- the exact source summary, transaction epoch and source connection;
- the exact TEMP stage and future campaign session capabilities;
- immutable, one-shot, clone/substitution-resistant ownership receipt inputs;
- a factory/issuer boundary that cannot be invoked by structurally equal user
  objects; and
- tests for projection clone, seal substitution, source/stage/session swap,
  transaction mutation, second use and defensive immutability.

The A2b primitive may define what a future pre-rebind receipt contains. It may
not issue `pre-rebind-complete`; issuance requires Slice B rules 1–10.

### Queue 2 — Cursor Slice B

After A2b cross-runtime acceptance:

- create a private `STRICT, WITHOUT ROWID` TEMP seal table keyed by
  `(token_hash COLLATE BINARY, tenant_id COLLATE BINARY)`;
- walk main cursors in the existing tenant/token PK order, one row at a time;
- call the A1 decoder, reduce raw BLOBs to bounded length/digest evidence,
  insert one closed carrier with exact write delta and release raw data;
- stream the TEMP table in token/tenant order without a sorter or proportional
  collection;
- execute only rules 1–10 in registry order;
- bind event snapshots to retained historical tails and checkpoint snapshots
  to exact historical `put` revisions while allowing later current mutation;
- retain exact transaction/write/main-catalog/TEMP-catalog/count/coverage and
  close-once lifecycle fences;
- return an opaque receipt only after all ten rules and clock proof succeed;
  and
- keep `cursor/clock-complete`, real rebind, rules 11/12, `0002` and permanent
  writes unreachable.

### Queue 3 — Product critical path D6

The task dependency graph has exactly one planned product task whose declared
dependencies are all completed:

`D6-ROUTER-BARRIER-023 — scheduler-integrated conditional routers and
quorum/deadline barriers`.

It should proceed in a separate path lease while SQLite A2b/Slice B advances:

- freeze runtime router/barrier semantics and shared cases;
- integrate conditional edge activation with both schedulers;
- persist deterministic route decisions and replay them without rejudging;
- implement all/minimum/percentage/quorum/deadline releases;
- preserve complete success/failure/missing/timeout/abstain/unknown statistics;
- use an injected deterministic clock;
- define late arrival, cancellation, no-match and human-escalation behavior;
- compare cross-runtime result bytes, event order and provider call counts; and
- close the six expected D6 tests without claiming later verifier completion.

D6 unlocks the verifier/judge/reflection line and multiple complete pattern
bundles. The broad dependency path remains D6 → verification → durability and
redaction → budget/model routing → isolation → adapters → API/plugin/MCP and
patterns → workers/observability/Explorer → security/Beta/RC/provenance/release.

## Completion rule retained

The master-plan goal remains active. Neither a green narrow suite, an existing
file, a healthy scanner entry, a preview schema nor an appended plan paragraph
counts as plan completion. Completion requires every explicit deliverable and
gate to have current, candidate-bound, proportionate evidence. No such global
claim is made by this audit.
